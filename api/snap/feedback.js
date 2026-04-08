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
 * Returns a fresh snap JSON tree representing the new state. After a rating
 * submission, stats are always re-read from Redis to avoid staleness.
 */
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

    // Log the raw incoming body so we can see exactly what the snap client sends.
    // The shape isn't 100% pinned down across snap clients yet — accept several.
    console.log('feedback POST:', { id, view, body: req.body });

    const steelman = await loadSteelman(id);
    if (!steelman) return sendSnapError(res, 404, 'steelman not found');

    const rating = extractRating(req.body);

    if (rating != null) {
      try {
        await addRating(id, rating);
      } catch (e) {
        // Don't 500 the user if the rating value is bad — log it, just don't record.
        console.warn('addRating rejected:', e.message);
      }
      view = 'rated';
    }

    // Always read from Redis — never trust a cached return value.
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
 * Try the documented one first, then a couple of fallbacks before giving up.
 */
function extractRating(body) {
  if (!body || typeof body !== 'object') return null;

  const candidates = [
    body?.inputs?.rating,
    body?.values?.rating,
    body?.action?.inputs?.rating,
    body?.rating
  ];

  for (const c of candidates) {
    if (c != null && c !== '') return c;
  }
  return null;
}
