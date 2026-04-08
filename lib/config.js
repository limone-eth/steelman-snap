// -----------------------------
// Farcaster contracts (Optimism)
// — used by scripts/register-fid + scripts/add-signer
// -----------------------------
const CONTRACTS = {
  ID_GATEWAY: '0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69',
  ID_REGISTRY: '0x00000000Fc6c5F01Fc30151999387Bb99A9f489b',
  KEY_GATEWAY: '0x00000000fC56947c7E7183f8Ca4B62398CaAdf0B',
  KEY_REGISTRY: '0x00000000Fc1237824fb747aBDE0FF18990E59b7e',
  SIGNED_KEY_REQUEST_VALIDATOR: '0x00000000FC700472606ED4fA22623Acf62c60553',
  BUNDLER: '0x00000000FC04c910A0b5feA33b03E0447AD0B0aA'
};

const RPC = {
  OPTIMISM: process.env.RPC_OPTIMISM || 'https://mainnet.optimism.io',
  BASE: process.env.RPC_BASE || 'https://mainnet.base.org'
};

const ABIS = {
  ID_GATEWAY: [
    'function register(address recovery) payable returns (uint256 fid, uint256 overpayment)',
    'function price() view returns (uint256)'
  ],
  ID_REGISTRY: ['function idOf(address owner) view returns (uint256)'],
  KEY_GATEWAY: [
    'function add(uint32 keyType, bytes key, uint8 metadataType, bytes metadata) external'
  ],
  SIGNED_KEY_REQUEST_VALIDATOR: [
    'function encodeMetadata((uint256 requestFid, address requestSigner, bytes signature, uint256 deadline)) pure returns (bytes)'
  ],
  ERC20: [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)'
  ]
};

// -----------------------------
// Neynar hub (x402 micropayments)
// — used by lib/x402 for runtime cast publishing + reads
// -----------------------------
const NEYNAR = {
  HUB_API: 'hub-api.neynar.com',
  API: 'api.neynar.com',
  PAY_TO: '0xA6a8736f18f383f1cc2d938576933E5eA7Df01A1',
  PAYMENT_AMOUNT: 10000n // 0.01 USDC (6 decimals) — must match hub x402 `maxAmountRequired`
};

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// -----------------------------
// EIP-712 domains + types
// -----------------------------
const EIP712 = {
  // Used by scripts/add-signer when signing the key request
  SIGNED_KEY_REQUEST: {
    name: 'Farcaster SignedKeyRequestValidator',
    version: '1',
    chainId: 10, // Optimism
    verifyingContract: CONTRACTS.SIGNED_KEY_REQUEST_VALIDATOR
  },
  // Used by lib/x402 for USDC TransferWithAuthorization on Base
  USDC_BASE: {
    name: 'USD Coin',
    version: '2',
    chainId: 8453,
    verifyingContract: USDC_BASE
  }
};

const EIP712_TYPES = {
  SIGNED_KEY_REQUEST: {
    SignedKeyRequest: [
      { name: 'requestFid', type: 'uint256' },
      { name: 'key', type: 'bytes' },
      { name: 'deadline', type: 'uint256' }
    ]
  },
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

module.exports = { CONTRACTS, RPC, ABIS, NEYNAR, USDC_BASE, EIP712, EIP712_TYPES };
