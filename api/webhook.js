require('dotenv').config();

const crypto = require('crypto');

const { postCast } = require('../lib/farcaster');
const { getCastByHash } = require('../lib/neynar');
const { generateSteelman } = require('../lib/steelman');
const { saveSteelman, claimTriggerCast, releaseTriggerCast } = require('../lib/storage');
const { snapUrl } = require('../lib/snap-builder');

const CUSTODY_PRIVATE_KEY = process.env.CUSTODY_PRIVATE_KEY;
const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY;
const AGENT_FID = parseInt(process.env.AGENT_FID || '0', 10);
const AGENT_USERNAME = (process.env.AGENT_USERNAME || 'steelmanbot').replace(/^@/, '').toLowerCase();
const NEYNAR_WEBHOOK_SECRET = process.env.NEYNAR_WEBHOOK_SECRET;

/**
 * Vercel auto-parses JSON bodies, but Neynar's signature is HMAC-SHA512 over
 * the raw bytes — re-stringifying parsed JSON would change whitespace / key
 * order and break verification. Disabling the body parser lets us read the
 * stream ourselves.
 */
module.exports.config = {
  api: { bodyParser: false }
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Verify the X-Neynar-Signature header against an HMAC-SHA512 of the raw body.
 * Returns true if valid, false otherwise. Constant-time comparison.
 *
 * Docs: https://docs.neynar.com/docs/how-to-verify-the-incoming-webhooks-using-signatures
 */
function verifyNeynarSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;

  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

  if (expected.length !== signatureHeader.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

/**
 * Decide whether this incoming cast should trigger a steelman.
 * Triggers when the bot is @mentioned (text or mentioned_profiles).
 */
function isSteelmanTrigger(cast) {
  const text = (cast.text || '').toLowerCase();
  if (text.includes(`@${AGENT_USERNAME}`)) return true;

  const mentioned = cast.mentioned_profiles || cast.mentionedProfiles || [];
  return mentioned.some((p) => p?.fid === AGENT_FID);
}

/**
 * Find the cast we should steelman.
 * Priority:
 *   1. If the trigger is a reply, the parent of the trigger is the target.
 *   2. Otherwise, the trigger cast itself is the target (e.g. a quote-mention).
 */
async function resolveTargetCast(triggerCast) {
  const parentHash = triggerCast.parent_hash || triggerCast.parentHash;
  if (parentHash) {
    const parent = await getCastByHash(parentHash);
    if (parent) return parent;
  }
  return triggerCast;
}

function newSteelmanId() {
  return crypto.randomBytes(6).toString('base64url');
}

/**
 * Neynar webhook entry point.
 *
 * Flow:
 *   1. Verify HMAC signature against NEYNAR_WEBHOOK_SECRET
 *   2. Filter to cast.created mentioning us
 *   3. Resolve the target cast (parent if reply, else the trigger itself)
 *   4. Generate steelman/weakman/agree via OpenRouter
 *   5. Persist in Upstash under a short id
 *   6. Reply to the trigger with the snap URL as an embed
 */
module.exports = async (req, res) => {
  // Health check / Neynar URL verification — respond 200 to any GET so the
  // dashboard "test webhook" / URL preflight passes without trying to forge
  // a fake event.
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'steelman-snap webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!AGENT_FID) {
      return res.status(500).json({ error: 'AGENT_FID is not set' });
    }

    // --- Read raw body (Vercel body parser disabled above) ---
    const rawBody = await readRawBody(req);

    // --- Verify signature ---
    if (NEYNAR_WEBHOOK_SECRET) {
      const sig = req.headers['x-neynar-signature'];
      if (!verifyNeynarSignature(rawBody, sig, NEYNAR_WEBHOOK_SECRET)) {
        console.warn('Rejected webhook with invalid signature');
        return res.status(401).json({ error: 'invalid signature' });
      }
    } else {
      console.warn(
        'NEYNAR_WEBHOOK_SECRET is not set — skipping signature verification. ' +
        'Set it in production to prevent unauthorized webhook calls.'
      );
    }

    // --- Parse body ---
    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'invalid JSON' });
    }

    if (!event?.type || !event?.data) {
      return res.status(400).json({ error: 'Invalid event structure' });
    }
    if (event.type !== 'cast.created') {
      return res.status(200).json({ message: 'ignored', type: event.type });
    }

    const triggerCast = event.data;
    const triggerAuthor = triggerCast.author || {};

    if (triggerAuthor.fid === AGENT_FID) {
      return res.status(200).json({ message: 'ignoring own cast' });
    }
    if (!isSteelmanTrigger(triggerCast)) {
      return res.status(200).json({ message: 'not a mention' });
    }

    // Dedupe: claim this trigger cast atomically so Neynar retries (or any
    // duplicate delivery) can't cause us to reply twice. If another
    // invocation already claimed it, ack 200 and bail out.
    const claimed = await claimTriggerCast(triggerCast.hash);
    if (!claimed) {
      console.log(`Skipping duplicate trigger ${triggerCast.hash}`);
      return res.status(200).json({ message: 'duplicate trigger', hash: triggerCast.hash });
    }

    let target;
    try {
      target = await resolveTargetCast(triggerCast);
    } catch (err) {
      await releaseTriggerCast(triggerCast.hash);
      throw err;
    }
    if (!target?.text) {
      // Nothing to do, but the claim still stands so we don't reprocess.
      return res.status(200).json({ message: 'no target text to steelman' });
    }

    try {
      console.log(
        `Steelmanning cast ${target.hash} by @${target.author?.username || 'anon'}`
      );

      const { strong, weak, agree } = await generateSteelman(
        target.text,
        target.author?.username
      );

      const id = newSteelmanId();
      await saveSteelman({
        id,
        parentHash: target.hash,
        parentAuthor: target.author?.username || 'anon',
        parentText: target.text,
        strong,
        weak,
        agree,
        createdAt: Date.now()
      });

      const url = snapUrl(id);
      const replyText = "here's the steelman ↓";

      const result = await postCast({
        custodyPrivateKey: CUSTODY_PRIVATE_KEY,
        signerPrivateKey: SIGNER_PRIVATE_KEY,
        fid: AGENT_FID,
        text: replyText,
        embedUrls: [url],
        parentHash: triggerCast.hash,
        parentFid: triggerAuthor.fid
      });

      console.log(`Posted steelman reply ${result.hash} → ${url}`);

      return res.status(200).json({
        success: true,
        castHash: result.hash,
        steelmanId: id,
        snapUrl: url
      });
    } catch (err) {
      // Release the claim so Neynar's retry has a chance to succeed.
      await releaseTriggerCast(triggerCast.hash).catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error('webhook error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};
