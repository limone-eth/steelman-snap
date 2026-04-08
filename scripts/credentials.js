const fs = require('fs');
const path = require('path');

/**
 * Local credential storage for the agent identity created by the setup scripts.
 *
 * Stores credentials in ./credentials.json (gitignored). Each FID is keyed
 * separately so you can keep multiple agents in one file, with `_active`
 * pointing at whichever you want the bot to use by default.
 */
function getCredentialsPath() {
  return path.join(process.cwd(), 'credentials.json');
}

/**
 * @param {Object} credentials
 * @param {string} credentials.fid
 * @param {string} credentials.custodyAddress
 * @param {string} credentials.custodyPrivateKey
 * @param {string} credentials.signerPublicKey
 * @param {string} credentials.signerPrivateKey
 */
function saveCredentials(credentials) {
  const filePath = getCredentialsPath();

  let existing = {};
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      existing = {};
    }
  }

  const fid = credentials.fid.toString();
  existing[fid] = {
    fid,
    custodyAddress: credentials.custodyAddress,
    custodyPrivateKey: credentials.custodyPrivateKey,
    signerPublicKey: credentials.signerPublicKey,
    signerPrivateKey: credentials.signerPrivateKey,
    createdAt: credentials.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  existing._active = fid;

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), { mode: 0o600 });
  console.log('Credentials saved to:', filePath);
  return filePath;
}

/**
 * @param {Object} [options]
 * @param {string} [options.fid] - Specific FID to load (defaults to active)
 */
function loadCredentials(options = {}) {
  const filePath = getCredentialsPath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (options.fid) return data[options.fid.toString()] || null;
    if (data._active && data[data._active]) return data[data._active];
    const fids = Object.keys(data).filter((k) => k !== '_active');
    return fids.length ? data[fids[0]] : null;
  } catch (e) {
    console.error('Error loading credentials:', e.message);
    return null;
  }
}

function listCredentials() {
  const filePath = getCredentialsPath();
  if (!fs.existsSync(filePath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const activeId = data._active;
    return Object.keys(data)
      .filter((k) => k !== '_active')
      .map((fid) => ({
        fid,
        custodyAddress: data[fid].custodyAddress,
        isActive: fid === activeId,
        createdAt: data[fid].createdAt
      }));
  } catch {
    return [];
  }
}

// CLI usage
if (require.main === module) {
  const command = process.argv[2];

  if (command === 'list') {
    const accounts = listCredentials();
    if (!accounts.length) {
      console.log('No credentials stored.');
    } else {
      console.log('Stored Farcaster accounts:');
      accounts.forEach((a) => {
        const active = a.isActive ? ' (active)' : '';
        console.log(`  FID ${a.fid}${active}`);
        console.log(`    Address: ${a.custodyAddress}`);
      });
    }
  } else if (command === 'get') {
    const fid = process.argv[3];
    const creds = loadCredentials({ fid });
    if (creds) {
      console.log(JSON.stringify(creds, null, 2));
    } else {
      console.log('No credentials found');
    }
  } else if (command === 'path') {
    console.log(getCredentialsPath());
  } else {
    console.log('Usage:');
    console.log('  node scripts/credentials.js list       — List stored accounts');
    console.log('  node scripts/credentials.js get [fid]  — Get credentials JSON');
    console.log('  node scripts/credentials.js path       — Show credentials file path');
  }
}

module.exports = { saveCredentials, loadCredentials, listCredentials, getCredentialsPath };
