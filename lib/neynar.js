require('dotenv').config();

const { resolveCustodySigner } = require('./custody');
const { getCast } = require('./x402');

let custodySignerPromise = null;

async function getCustodySigner() {
  if (!custodySignerPromise) {
    custodySignerPromise = resolveCustodySigner(process.env.CUSTODY_PRIVATE_KEY);
  }
  return custodySignerPromise;
}

/**
 * Fetch a cast by its hash via Neynar (paid with x402 USDC on Base).
 * Used to load the parent cast we're steelmanning.
 *
 * @param {string} hash - 0x-prefixed cast hash
 */
async function getCastByHash(hash) {
  const wallet = await getCustodySigner();
  const result = await getCast(wallet, hash);

  if (result.status !== 200) {
    const detail =
      typeof result.data === 'string' ? result.data : JSON.stringify(result.data || {});
    throw new Error(`Neynar API ${result.status}: ${detail}`);
  }

  return result.data?.cast || null;
}

module.exports = { getCastByHash };
