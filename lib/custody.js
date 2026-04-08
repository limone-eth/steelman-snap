require('dotenv').config();

const { Wallet } = require('ethers');

/**
 * Resolve custody signer for Farcaster operations.
 * Loads an ethers Wallet from CUSTODY_PRIVATE_KEY (or PRIVATE_KEY).
 *
 * @param {string} [privateKey] - 0x-prefixed custody private key
 * @returns {Promise<import('ethers').Wallet>}
 */
async function resolveCustodySigner(privateKey) {
  const pk = privateKey || process.env.CUSTODY_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error('Set CUSTODY_PRIVATE_KEY or PRIVATE_KEY');
  }
  return new Wallet(pk);
}

/**
 * @param {import('ethers').Wallet} wallet
 */
async function getWalletAddress(wallet) {
  if (wallet?.address) return wallet.address;
  return wallet.getAddress();
}

module.exports = {
  resolveCustodySigner,
  getWalletAddress
};
