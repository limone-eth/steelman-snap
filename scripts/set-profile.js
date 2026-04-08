require('dotenv').config();

const https = require('https');
const {
  makeUserDataAdd,
  makeUserNameProofClaim,
  EthersEip712Signer,
  NobleEd25519Signer,
  UserDataType,
  FarcasterNetwork,
  Message
} = require('@farcaster/hub-nodejs');

const { resolveCustodySigner } = require('../lib/custody');
const { submitMessage } = require('../lib/x402');
const { loadCredentials } = require('./credentials');

/**
 * Set the agent's profile (fname, display name, bio, pfp URL).
 *
 * Uses the same x402 + Neynar hub plumbing as lib/farcaster — no Neynar API
 * key required. Profile fields are written as UserDataAdd messages signed
 * with the local Ed25519 signer; fname registration goes through the public
 * fnames.farcaster.xyz transfer endpoint and then a UserDataAdd:USERNAME.
 *
 * Source of values (in priority order):
 *   1. CLI flags: --fname / --display / --bio / --pfp
 *   2. Env vars:  AGENT_FNAME / AGENT_DISPLAY_NAME / AGENT_BIO / AGENT_PFP_URL
 *
 * Each field is independent — the script only updates the ones you provide.
 */

const FNAME_REGEX = /^[a-z0-9][a-z0-9-]{0,15}$/;

/**
 * Register an fname with the public Farcaster name server, then announce
 * the username to the Neynar hub. Idempotent-ish — if the fname is already
 * taken, the fnames server returns an error and we bail.
 */
async function registerFname({ custody, signer, fid, fname }) {
  if (!FNAME_REGEX.test(fname)) {
    throw new Error(
      'Invalid fname. Must be lowercase alphanumeric, 1–16 chars, may contain hyphens but not start with one.'
    );
  }

  console.log(`Registering fname @${fname} for FID ${fid}...`);

  // Step 1: sign the username proof claim with the custody key (EIP-712)
  const eip712Signer = new EthersEip712Signer(custody);
  const timestamp = Math.floor(Date.now() / 1000);
  const claim = makeUserNameProofClaim({
    name: fname,
    owner: custody.address,
    timestamp
  });

  const sigResult = await eip712Signer.signUserNameProofClaim(claim);
  if (sigResult.isErr()) {
    throw new Error(`Failed to sign fname claim: ${sigResult.error}`);
  }
  const signature = '0x' + Buffer.from(sigResult.value).toString('hex');

  // Step 2: POST to fnames.farcaster.xyz/transfers
  const body = JSON.stringify({
    name: fname,
    from: 0, // 0 = new registration
    to: fid,
    fid,
    owner: custody.address,
    timestamp,
    signature
  });

  const fnameRes = await httpsPost('fnames.farcaster.xyz', '/transfers', body);
  if (fnameRes.status !== 200) {
    throw new Error(`fname server rejected: ${JSON.stringify(fnameRes.data)}`);
  }
  console.log('  fname registered with server. Transfer id:', fnameRes.data?.transfer?.id);

  // Step 3: wait for hub to sync the new fname → FID mapping
  console.log('  Waiting 30s for hub sync...');
  await sleep(30_000);

  // Step 4: announce USERNAME via UserDataAdd to the hub
  await submitUserData({
    custody,
    signer,
    fid,
    type: UserDataType.USERNAME,
    value: fname,
    label: 'username',
    retryOnFailure: true
  });
}

/**
 * Build a UserDataAdd message, sign with the ed25519 signer, submit via x402.
 */
async function submitUserData({ custody, signer, fid, type, value, label, retryOnFailure = false }) {
  console.log(`Setting ${label}: ${value}`);

  const msgResult = await makeUserDataAdd(
    { type, value },
    { fid, network: FarcasterNetwork.MAINNET },
    signer
  );

  if (msgResult.isErr()) {
    throw new Error(`Failed to build ${label} message: ${msgResult.error}`);
  }

  const bytes = Buffer.from(Message.encode(msgResult.value).finish());

  let result = await submitMessage(custody, bytes);
  if (result.status !== 200 && retryOnFailure) {
    console.log(`  Hub rejected (${result.status}), waiting 30s and retrying...`);
    await sleep(30_000);
    result = await submitMessage(custody, bytes);
  }

  if (result.status !== 200) {
    throw new Error(
      `Failed to submit ${label}: ${typeof result.data === 'string' ? result.data : JSON.stringify(result.data)}`
    );
  }

  console.log(`  ${label} updated.`);
}

/**
 * Orchestrator. Each section is optional — only runs if a value is provided.
 */
async function setProfile({ fid, custody, signer, fname, displayName, bio, pfpUrl }) {
  console.log(`\n=== set-profile for FID ${fid} ===\n`);

  if (fname) {
    await registerFname({ custody, signer, fid, fname });
    console.log('');
  }

  if (displayName) {
    await submitUserData({
      custody,
      signer,
      fid,
      type: UserDataType.DISPLAY,
      value: displayName,
      label: 'display name'
    });
  }

  if (bio) {
    await submitUserData({
      custody,
      signer,
      fid,
      type: UserDataType.BIO,
      value: bio,
      label: 'bio'
    });
  }

  if (pfpUrl) {
    await submitUserData({
      custody,
      signer,
      fid,
      type: UserDataType.PFP,
      value: pfpUrl,
      label: 'pfp'
    });
  }

  console.log('\n=== done ===');
  if (fname) {
    console.log(`View at: https://farcaster.xyz/${fname}`);
  } else {
    console.log(`View at: https://farcaster.xyz/~/profiles/${fid}`);
  }
}

// -----------------------------
// helpers
// -----------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        port: 443,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Pull a value from --flag CLI args, then env vars, then default.
 */
function pickArg(argv, flag, envName) {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return process.env[envName] || undefined;
}

// -----------------------------
// CLI entry point
// -----------------------------

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);

    // Resolve identity: env vars first, then credentials.json (from `npm run setup`).
    let fid = parseInt(process.env.AGENT_FID || '0', 10);
    let custodyPrivateKey = process.env.CUSTODY_PRIVATE_KEY;
    let signerPrivateKey = process.env.SIGNER_PRIVATE_KEY;
    let identitySource = 'env';

    if (!fid || !custodyPrivateKey || !signerPrivateKey) {
      const creds = loadCredentials();
      if (creds) {
        fid = fid || parseInt(creds.fid, 10);
        custodyPrivateKey = custodyPrivateKey || creds.custodyPrivateKey;
        signerPrivateKey = signerPrivateKey || creds.signerPrivateKey;
        identitySource = 'credentials.json';
      }
    }

    const fname = pickArg(argv, '--fname', 'AGENT_FNAME');
    const displayName = pickArg(argv, '--display', 'AGENT_DISPLAY_NAME');
    const bio = pickArg(argv, '--bio', 'AGENT_BIO');
    const pfpUrl = pickArg(argv, '--pfp', 'AGENT_PFP_URL');

    if (!fid || !custodyPrivateKey || !signerPrivateKey) {
      console.log('Missing AGENT_FID / CUSTODY_PRIVATE_KEY / SIGNER_PRIVATE_KEY.\n');
      console.log('Set them in .env, or run `npm run setup` first to create credentials.json.\n');
      console.log('Usage:');
      console.log('  npm run profile -- --fname myname --display "My Bot" --bio "Steelmans contentious casts" --pfp https://...');
      console.log('\nOr set AGENT_FNAME / AGENT_DISPLAY_NAME / AGENT_BIO / AGENT_PFP_URL in .env');
      process.exit(1);
    }

    console.log(`Using identity from ${identitySource} (FID ${fid})`);

    if (!fname && !displayName && !bio && !pfpUrl) {
      console.log('Nothing to update. Pass at least one of:');
      console.log('  --fname <name>     or set AGENT_FNAME');
      console.log('  --display <name>   or set AGENT_DISPLAY_NAME');
      console.log('  --bio <text>       or set AGENT_BIO');
      console.log('  --pfp <url>        or set AGENT_PFP_URL');
      process.exit(1);
    }

    try {
      const custody = await resolveCustodySigner(custodyPrivateKey);
      const signer = new NobleEd25519Signer(Buffer.from(signerPrivateKey, 'hex'));

      await setProfile({ fid, custody, signer, fname, displayName, bio, pfpUrl });
      process.exit(0);
    } catch (err) {
      console.error('\nError:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = { setProfile, registerFname };
