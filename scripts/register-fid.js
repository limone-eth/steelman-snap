require('dotenv').config();

const { Wallet, JsonRpcProvider, Contract, formatEther } = require('ethers');
const { CONTRACTS, RPC, ABIS } = require('../lib/config');

/**
 * Register a new Farcaster ID (FID) on Optimism for the wallet derived from
 * `privateKey`. Idempotent — if the wallet already has a FID, it returns it
 * without sending a transaction.
 *
 * Cost: ~0.001 ETH on Optimism (gas + protocol fee).
 *
 * @param {string} privateKey - 0x-prefixed wallet private key
 * @returns {Promise<{ fid: bigint, txHash: string | null }>}
 */
async function registerFid(privateKey) {
  const provider = new JsonRpcProvider(RPC.OPTIMISM);
  const wallet = new Wallet(privateKey, provider);

  console.log('Wallet address:', wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log('Balance:', formatEther(balance), 'ETH');

  const idRegistry = new Contract(CONTRACTS.ID_REGISTRY, ABIS.ID_REGISTRY, provider);
  const existingFid = await idRegistry.idOf(wallet.address);

  if (existingFid > 0n) {
    console.log('Already registered with FID:', existingFid.toString());
    return { fid: existingFid, txHash: null };
  }

  const idGateway = new Contract(CONTRACTS.ID_GATEWAY, ABIS.ID_GATEWAY, wallet);
  const price = await idGateway.price();
  console.log('Registration price:', formatEther(price), 'ETH');

  if (balance < price) {
    throw new Error(
      `Insufficient balance. Need ${formatEther(price)} ETH, have ${formatEther(balance)} ETH`
    );
  }

  console.log('Registering FID...');
  const tx = await idGateway.register(
    wallet.address, // recovery address = self
    {
      value: price + 50000000000000n, // small buffer
      gasLimit: 400000n
    }
  );

  console.log('Transaction:', tx.hash);
  console.log('Waiting for confirmation...');
  await tx.wait();

  const fid = await idRegistry.idOf(wallet.address);
  console.log('SUCCESS — registered FID:', fid.toString());

  return { fid, txHash: tx.hash };
}

// CLI usage
if (require.main === module) {
  const privateKey = process.env.PRIVATE_KEY || process.argv[2];

  if (!privateKey) {
    console.log('Usage: PRIVATE_KEY=0x... node scripts/register-fid.js');
    console.log('   or: node scripts/register-fid.js 0x...');
    process.exit(1);
  }

  registerFid(privateKey)
    .then(({ fid, txHash }) => {
      console.log('\n=== Registration Complete ===');
      console.log('FID:', fid.toString());
      if (txHash) console.log('TX:', txHash);
    })
    .catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { registerFid };
