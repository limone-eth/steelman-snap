const {
  makeCastAdd,
  NobleEd25519Signer,
  FarcasterNetwork,
  Message
} = require('@farcaster/hub-nodejs');
const { resolveCustodySigner } = require('./custody');
const { submitMessage } = require('./x402');

/**
 * Post a cast (or reply) to Farcaster, optionally with embeds.
 *
 * @param {Object} options
 * @param {string} [options.custodyPrivateKey] - EVM custody key (or env CUSTODY_PRIVATE_KEY)
 * @param {string} options.signerPrivateKey - Ed25519 signer private key (hex)
 * @param {number} options.fid - Farcaster ID
 * @param {string} options.text - Cast text content
 * @param {string[]} [options.embedUrls] - URLs to attach as embeds (e.g. snap URLs)
 * @param {string} [options.parentHash] - Parent cast hash for replies
 * @param {string} [options.parentFid] - Parent cast author FID for replies
 */
async function postCast({
  custodyPrivateKey,
  signerPrivateKey,
  fid,
  text,
  embedUrls = [],
  parentHash,
  parentFid
}) {
  const custody = await resolveCustodySigner(custodyPrivateKey);
  const signer = new NobleEd25519Signer(Buffer.from(signerPrivateKey, 'hex'));

  const castData = {
    text,
    embeds: embedUrls.map((url) => ({ url })),
    embedsDeprecated: [],
    mentions: [],
    mentionsPositions: []
  };

  if (parentHash && parentFid) {
    castData.parentCastId = {
      hash: Buffer.from(parentHash.replace('0x', ''), 'hex'),
      fid: Number(parentFid)
    };
  }

  const castResult = await makeCastAdd(
    castData,
    { fid, network: FarcasterNetwork.MAINNET },
    signer
  );

  if (castResult.isErr()) {
    throw new Error(`Failed to create cast: ${castResult.error}`);
  }

  const messageBytes = Buffer.from(Message.encode(castResult.value).finish());
  const hash = '0x' + Buffer.from(castResult.value.hash).toString('hex');

  const result = await submitMessage(custody, messageBytes);

  if (result.status !== 200) {
    throw new Error(`Failed to submit cast: ${JSON.stringify(result.data)}`);
  }

  return { hash, success: true };
}

module.exports = { postCast };
