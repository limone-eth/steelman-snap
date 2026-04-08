require('dotenv').config();

const crypto = require('crypto');

const { postCast } = require('../lib/farcaster');
const { getCastByHash } = require('../lib/neynar');
const { generateSteelman } = require('../lib/steelman');
const { saveSteelman } = require('../lib/storage');
const { snapUrl } = require('../lib/snap-builder');

const CUSTODY_PRIVATE_KEY = process.env.CUSTODY_PRIVATE_KEY;
const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY;
const AGENT_FID = parseInt(process.env.AGENT_FID || '0', 10);
const AGENT_USERNAME = (process.env.AGENT_USERNAME || 'steelmanbot').replace(/^@/, '').toLowerCase();

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
 *   1. Filter to cast.created mentioning us
 *   2. Resolve the target cast (parent if reply, else the trigger itself)
 *   3. Generate steelman/weakman/agree via OpenRouter
 *   4. Persist in Upstash under a short id
 *   5. Reply to the trigger with the snap URL as an embed
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!AGENT_FID) {
      return res.status(500).json({ error: 'AGENT_FID is not set' });
    }

    const event = req.body;
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

    const target = await resolveTargetCast(triggerCast);
    if (!target?.text) {
      return res.status(200).json({ message: 'no target text to steelman' });
    }

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
    console.error('webhook error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};
