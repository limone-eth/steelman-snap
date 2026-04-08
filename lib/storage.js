const { Redis } = require('@upstash/redis');

let client = null;

function getClient() {
  if (!client) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
    }
    client = new Redis({ url, token });
  }
  return client;
}

const KEY = (id) => `steelman:${id}`;
const RATING_KEY = (id) => `steelman:${id}:ratings`;
const PROCESSED_KEY = (hash) => `steelman:processed:${hash}`;

// Keep the dedupe marker around long enough to cover Neynar retries and any
// reasonable replay window, but not forever.
const PROCESSED_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Atomically claim a trigger cast hash so we only reply to it once.
 * Returns true if this caller won the claim (i.e. should process), false if
 * another invocation already claimed it.
 */
async function claimTriggerCast(hash) {
  if (!hash) return true;
  const res = await getClient().set(PROCESSED_KEY(hash), '1', {
    nx: true,
    ex: PROCESSED_TTL_SECONDS
  });
  return res === 'OK';
}

/**
 * Release a previously-claimed trigger cast. Use this if processing failed
 * and we want Neynar's retry to get another shot.
 */
async function releaseTriggerCast(hash) {
  if (!hash) return;
  await getClient().del(PROCESSED_KEY(hash));
}

/**
 * @typedef {Object} Steelman
 * @property {string} id
 * @property {string} parentHash       cast hash being steelmanned
 * @property {string} parentAuthor     username
 * @property {string} parentText       original cast text
 * @property {string} strong           strongest version of the argument
 * @property {string} weak             weakest version of the argument
 * @property {string} agree            common ground / what both sides could agree on
 * @property {number} createdAt        unix ms
 */

/** @param {Steelman} steelman */
async function saveSteelman(steelman) {
  await getClient().set(KEY(steelman.id), JSON.stringify(steelman));
}

/** @returns {Promise<Steelman | null>} */
async function loadSteelman(id) {
  const raw = await getClient().get(KEY(id));
  if (!raw) return null;
  // Upstash sometimes returns the parsed object directly
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/**
 * Append a rating (1–5) and return updated stats. Stores as a string to
 * avoid any Upstash JSON-deserialization weirdness on read-back.
 *
 * @returns {Promise<{ count: number, avg: number }>}
 */
async function addRating(id, rating) {
  const n = Number(rating);
  if (!Number.isFinite(n) || n < 1 || n > 5) {
    throw new Error(`rating must be 1..5 (got ${JSON.stringify(rating)})`);
  }
  const r = getClient();
  await r.rpush(RATING_KEY(id), String(n));
  console.log(`addRating: stored ${n} for ${id}`);
  return getRatingStats(id);
}

/**
 * Read all ratings for an id and compute count + average. Always re-reads
 * from Upstash, never trusts a cached return value.
 *
 * @returns {Promise<{ count: number, avg: number }>}
 */
async function getRatingStats(id) {
  const all = (await getClient().lrange(RATING_KEY(id), 0, -1)) || [];
  const nums = all.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  const sum = nums.reduce((a, b) => a + b, 0);
  const stats = {
    count: nums.length,
    avg: nums.length ? sum / nums.length : 0
  };
  console.log(`getRatingStats(${id}): count=${stats.count} avg=${stats.avg.toFixed(2)} raw=${JSON.stringify(all)}`);
  return stats;
}

module.exports = {
  saveSteelman,
  loadSteelman,
  addRating,
  getRatingStats,
  claimTriggerCast,
  releaseTriggerCast
};
