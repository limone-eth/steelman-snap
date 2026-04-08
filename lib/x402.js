const { randomBytes } = require('ethers');
const https = require('https');
const { NEYNAR, USDC_BASE, EIP712, EIP712_TYPES } = require('./config');
const { getWalletAddress } = require('./custody');

/**
 * @param {import('ethers').Wallet} wallet
 */
async function createX402Header(wallet, paymentAmount = NEYNAR.PAYMENT_AMOUNT) {
  const nonce = '0x' + Buffer.from(randomBytes(32)).toString('hex');
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const from = await getWalletAddress(wallet);

  const signature = await wallet.signTypedData(
    EIP712.USDC_BASE,
    EIP712_TYPES.TRANSFER_WITH_AUTHORIZATION,
    {
      from,
      to: NEYNAR.PAY_TO,
      value: paymentAmount,
      validAfter: 0n,
      validBefore,
      nonce
    }
  );

  const payload = {
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    payload: {
      signature,
      authorization: {
        from,
        to: NEYNAR.PAY_TO,
        value: paymentAmount.toString(),
        validAfter: '0',
        validBefore: validBefore.toString(),
        nonce
      }
    }
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function getAcceptedX402Amount(responseData) {
  const accepts = responseData?.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) return null;
  const candidate = accepts.find((a) => {
    const scheme = String(a?.scheme || '').toLowerCase();
    const network = String(a?.network || '').toLowerCase();
    const asset = String(a?.asset || '').toLowerCase();
    return scheme === 'exact' && network === 'base' && asset === USDC_BASE.toLowerCase();
  });
  if (!candidate?.maxAmountRequired) return null;
  try {
    return BigInt(candidate.maxAmountRequired);
  } catch {
    return null;
  }
}

/**
 * @param {import('ethers').Wallet} wallet
 */
async function x402Request(wallet, options, body = null) {
  const perform = (header) =>
    new Promise((resolve, reject) => {
      const reqOptions = {
        ...options,
        port: 443,
        headers: {
          ...options.headers,
          'X-PAYMENT': header
        }
      };

      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      });

      req.on('error', reject);

      if (body) req.write(body);
      req.end();
    });

  function responseLooksOk(res) {
    if (res.status !== 200) return false;
    const d = res.data;
    if (d && typeof d === 'object' && d.error) return false;
    return true;
  }

  const defaultHeader = await createX402Header(wallet);
  const first = await perform(defaultHeader);

  if (responseLooksOk(first)) return first;

  const acceptedAmount = getAcceptedX402Amount(first.data);
  const errLower = String(first.data?.error || '').toLowerCase();
  const paymentRejected =
    errLower.includes('failed to verify payment') ||
    errLower.includes('verify payment') ||
    errLower.includes('payment');

  if (acceptedAmount && acceptedAmount !== NEYNAR.PAYMENT_AMOUNT && paymentRejected) {
    console.log(
      `x402 negotiation: retrying with accepted amount ${acceptedAmount.toString()} (${Number(acceptedAmount) / 1e6} USDC)`
    );
    const negotiatedHeader = await createX402Header(wallet, acceptedAmount);
    return perform(negotiatedHeader);
  }

  return first;
}

/**
 * @param {import('ethers').Wallet} wallet
 */
async function submitMessage(wallet, messageBytes) {
  return x402Request(
    wallet,
    {
      hostname: NEYNAR.HUB_API,
      path: '/v1/submitMessage',
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': messageBytes.length
      }
    },
    messageBytes
  );
}

/**
 * @param {import('ethers').Wallet} wallet
 */
async function getCast(wallet, castHash) {
  return x402Request(wallet, {
    hostname: NEYNAR.API,
    path: `/v2/farcaster/cast?identifier=${castHash}&type=hash`,
    method: 'GET',
    headers: { accept: 'application/json' }
  });
}

module.exports = { x402Request, submitMessage, getCast };
