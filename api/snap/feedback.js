require('dotenv').config();

const { loadSteelman, addRating, getRatingStats } = require('../../lib/storage');
const { buildSnap } = require('../../lib/snap-builder');
const { sendSnap, sendSnapError, handlePreflight } = require('../../lib/snap-response');

/**
 * POST /api/snap/feedback?id=<id>&view=<view>
 *
 * Handles two cases:
 *   1. View switch (Strongest / Weakest / Common ground buttons) — body has no rating
 *   2. Rating submission (Submit button) — body has the slider value
 *
 * Returns a fresh snap JSON tree representing the new state. Stats are
 * always re-read from Redis after a write to avoid staleness.
 */

/**
 * Disable Vercel's default body parser. Vercel only auto-parses
 * application/json and form-urlencoded — but snap clients may POST with
 * application/vnd.farcaster.snap+json (or similar), which would leave
 * req.body undefined and silently drop the slider value. We read the raw
 * stream and JSON.parse it ourselves so the content-type doesn't matter.
 */
module.exports.config = {
  api: { bodyParser: false }
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendSnapError(res, 405, 'Method not allowed');
  }

  try {
    const id = req.query?.id;
    let view = req.query?.view || 'strong';
    if (!id) return sendSnapError(res, 400, 'missing id');

    // Read + parse body manually so content-type doesn't trip Vercel's
    // default parser. Log everything so we can see exactly what shape the
    // snap client sends.
    const rawBody = await readRawBody(req);
    let body = {};
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch (e) {
        console.warn('feedback: body was not JSON:', rawBody.slice(0, 500));
      }
    }

    console.log('feedback POST:', {
      id,
      view,
      contentType: req.headers['content-type'],
      rawBodyLength: rawBody.length,
      body
    });

    const steelman = await loadSteelman(id);
    if (!steelman) return sendSnapError(res, 404, 'steelman not found');

    const rating = extractRating(body);

    if (rating != null) {
      try {
        await addRating(id, rating);
      } catch (e) {
        console.warn('addRating rejected:', e.message);
      }
      view = 'rated';
    } else if (view === 'rated') {
      // Submit button was pressed but we couldn't find a rating in the body.
      // Log loudly — this is the bug we're trying to debug.
      console.warn('rated view requested but no rating found in body:', body);
    }

    // Always re-read from Redis after any write.
    const stats = await getRatingStats(id);

    const snap = buildSnap(steelman, view, stats);
    return sendSnap(res, snap);
  } catch (err) {
    console.error('snap feedback error:', err);
    return sendSnapError(res, 500, err.message);
  }
};

/**
 * Different snap clients send slider input in slightly different shapes.
 * Try the documented one first, then several fallbacks. Each candidate is
 * coerced to a number; the first one that parses to a finite value wins.
 */
function extractRating(body) {
  if (!body || typeof body !== 'object') return null;

  const candidates = [
    body?.inputs?.rating,
    body?.values?.rating,
    body?.action?.inputs?.rating,
    body?.formData?.rating,
    body?.fields?.rating,
    body?.payload?.rating,
    body?.data?.rating,
    body?.untrustedData?.inputs?.rating,
    body?.rating
  ];

  for (const c of candidates) {
    if (c == null || c === '') continue;
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
