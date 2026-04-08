require('dotenv').config();

const { Wallet, JsonRpcProvider, formatEther, formatUnits, parseEther } = require('ethers');
const { Contract } = require('ethers');
const { RPC, USDC_BASE, ABIS } = require('../lib/config');
const { registerFid } = require('./register-fid');
const { addSigner } = require('./add-signer');
const { swapEthToUsdc } = require('./swap-to-usdc');
const { saveCredentials, getCredentialsPath } = require('./credentials');

/**
 * One-shot agent bootstrap. Assumes the custody wallet is already pre-funded
 * (no bridging logic — bring your own ETH). Roughly $1 of crypto is enough:
 *
 *   - Optimism:  ~0.001 ETH for FID registration + ~0.0001 ETH gas for signer
 *   - Base:      ~0.0005 ETH (most of which gets swapped to USDC for x402)
 *
 * If you have more than that, the script just uses what it needs.
 *
 * Steps:
 *   1. Verify ETH balance on Optimism + Base
 *   2. Register FID on Optimism
 *   3. Generate Ed25519 signer + add it via KeyGateway
 *   4. Swap a slice of ETH on Base → USDC (for runtime x402 micropayments)
 *   5. Save credentials.json
 *   6. Print env-var lines you can paste into .env
 */
async function setup(privateKey, options = {}) {
  const { swapEth = parseEther('0.0002') } = options;

  const wallet = new Wallet(privateKey);
  console.log('=== steelman-snap setup ===\n');
  console.log('Custody wallet:', wallet.address);

  // ---- Step 1: balance check ----
  const opProvider = new JsonRpcProvider(RPC.OPTIMISM);
  const baseProvider = new JsonRpcProvider(RPC.BASE);

  const opBalance = await opProvider.getBalance(wallet.address);
  const baseEthBalance = await baseProvider.getBalance(wallet.address);
  const usdc = new Contract(USDC_BASE, ABIS.ERC20, baseProvider);
  const baseUsdcBalance = await usdc.balanceOf(wallet.address);

  console.log('\nBalances:');
  console.log('  Optimism ETH:', formatEther(opBalance));
  console.log('  Base ETH:    ', formatEther(baseEthBalance));
  console.log('  Base USDC:   ', formatUnits(baseUsdcBalance, 6));

  const minOpEth = parseEther('0.0015');
  if (opBalance < minOpEth) {
    throw new Error(
      `Need at least ${formatEther(minOpEth)} ETH on Optimism for FID registration + signer. ` +
      `Currently have ${formatEther(opBalance)}.`
    );
  }

  // ---- Step 2: register FID ----
  console.log('\n--- Registering FID on Optimism ---');
  const { fid } = await registerFid(privateKey);

  // ---- Step 3: add signer ----
  console.log('\n--- Adding signer ---');
  const { signerPublicKey, signerPrivateKey } = await addSigner(privateKey);

  // ---- Step 4: swap to USDC if needed ----
  const minUsdcBuffer = 50000n; // 0.05 USDC = enough for ~5 casts/reads
  if (baseUsdcBalance < minUsdcBuffer) {
    if (baseEthBalance < swapEth) {
      console.warn(
        `\nWARN: Base ETH balance (${formatEther(baseEthBalance)}) is below the swap amount ` +
        `(${formatEther(swapEth)}) and Base USDC balance is below ${formatUnits(minUsdcBuffer, 6)}. ` +
        `Skipping swap — fund the wallet on Base before running the bot.`
      );
    } else {
      console.log('\n--- Swapping ETH → USDC on Base ---');
      await swapEthToUsdc(privateKey, swapEth);
    }
  } else {
    console.log('\nBase USDC balance already sufficient — skipping swap.');
  }

  // ---- Step 5: save credentials ----
  console.log('\n--- Saving credentials ---');
  const credentialsPath = saveCredentials({
    fid: fid.toString(),
    custodyAddress: wallet.address,
    custodyPrivateKey: privateKey,
    signerPublicKey,
    signerPrivateKey
  });

  // ---- Step 6: print .env lines ----
  console.log('\n=== Setup Complete ===');
  console.log('\nAdd the following to your .env (or Vercel project settings):\n');
  console.log(`AGENT_FID=${fid.toString()}`);
  console.log(`CUSTODY_PRIVATE_KEY=${privateKey}`);
  console.log(`SIGNER_PRIVATE_KEY=${signerPrivateKey}`);
  console.log('\nFull credentials saved to:', credentialsPath);
  console.log('(also gitignored — never commit this file)');

  return {
    fid: fid.toString(),
    custodyAddress: wallet.address,
    custodyPrivateKey: privateKey,
    signerPublicKey,
    signerPrivateKey,
    credentialsPath
  };
}

// CLI usage
if (require.main === module) {
  const privateKey = process.env.PRIVATE_KEY || process.argv[2];

  if (!privateKey) {
    console.log('Usage: PRIVATE_KEY=0x... node scripts/setup.js\n');
    console.log('This will, in order:');
    console.log('  1. Check your wallet balance on Optimism + Base');
    console.log('  2. Register a new FID on Optimism (~0.001 ETH)');
    console.log('  3. Generate an Ed25519 signer + add it via KeyGateway (~$0.05 gas)');
    console.log('  4. Swap a small amount of ETH → USDC on Base (for runtime x402)');
    console.log('  5. Save credentials.json + print the env vars to copy into .env\n');
    console.log('Pre-fund the wallet with ~$1 of ETH on Optimism + ~$0.50 on Base before running.\n');
    console.log('Credentials path:', getCredentialsPath());
    process.exit(1);
  }

  setup(privateKey)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\nError:', err.message);
      process.exit(1);
    });
}

module.exports = { setup };
