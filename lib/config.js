// Neynar Hub (supports x402 payments)
const NEYNAR = {
  HUB_API: 'hub-api.neynar.com',
  API: 'api.neynar.com',
  PAY_TO: '0xA6a8736f18f383f1cc2d938576933E5eA7Df01A1',
  PAYMENT_AMOUNT: 10000n // 0.01 USDC (6 decimals) — must match hub x402 `maxAmountRequired`
};

// USDC on Base (for x402 payments)
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// EIP-712 Domain (USDC TransferWithAuthorization on Base)
const EIP712 = {
  USDC_BASE: {
    name: 'USD Coin',
    version: '2',
    chainId: 8453,
    verifyingContract: USDC_BASE
  }
};

const EIP712_TYPES = {
  TRANSFER_WITH_AUTHORIZATION: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }
    ]
  }
};

module.exports = { NEYNAR, USDC_BASE, EIP712, EIP712_TYPES };
