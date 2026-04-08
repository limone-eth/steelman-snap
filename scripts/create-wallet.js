require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Wallet } = require('ethers');

const PENDING_PATH = path.join(process.cwd(), '.wallet-pending.json');

/**
 * Generate a fresh EVM wallet locally and persist it to .wallet-pending.json
 * (gitignored). The next `npm run setup` invocation will pick this file up
 * automatically — no need to set PRIVATE_KEY env yourself.
 *
 * The "pending" file is short-lived: once setup completes, the key is moved
 * into credentials.json under the new FID and .wallet-pending.json is deleted.
 *
 * Refuses to overwrite an existing pending file unless --force is passed.
 */
function createWallet({ force = false } = {}) {
  if (fs.existsSync(PENDING_PATH) && !force) {
    const existing = JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
    console.log('A pending wallet already exists at', PENDING_PATH);
    console.log('Address:', existing.address);
    console.log('\nFund it with ~$1 of ETH on Optimism + Base, then run `npm run setup`.');
    console.log('To replace it, run: npm run create-wallet -- --force');
    return existing;
  }

  const wallet = Wallet.createRandom();
  const record = {
    address: wallet.address,
    privateKey: wallet.privateKey,
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(PENDING_PATH, JSON.stringify(record, null, 2), { mode: 0o600 });

  console.log('=== New wallet created ===\n');
  console.log('Address:    ', wallet.address);
  console.log('Private key:', wallet.privateKey);
  console.log('\nSaved to:', PENDING_PATH);
  console.log('(gitignored — never commit this file)\n');
  console.log('Next steps:');
  console.log('  1. Fund this address with ~$1 of ETH:');
  console.log(`       - Optimism: ~0.0015 ETH  (FID registration + signer gas)`);
  console.log(`       - Base:     ~0.0002 ETH  (gets swapped to USDC for x402)`);
  console.log('  2. Run: npm run setup');

  return record;
}

function loadPendingWallet() {
  if (!fs.existsSync(PENDING_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
  } catch (e) {
    console.error('Could not read', PENDING_PATH, '-', e.message);
    return null;
  }
}

function deletePendingWallet() {
  if (fs.existsSync(PENDING_PATH)) {
    fs.unlinkSync(PENDING_PATH);
  }
}

// CLI usage
if (require.main === module) {
  const force = process.argv.includes('--force');
  createWallet({ force });
}

module.exports = { createWallet, loadPendingWallet, deletePendingWallet, PENDING_PATH };
