require('dotenv').config();

const crypto = require('crypto');
const { Wallet, JsonRpcProvider, Contract, formatEther } = require('ethers');
const { CONTRACTS, RPC, ABIS, EIP712, EIP712_TYPES } = require('../lib/config');

/**
 * Generate an Ed25519 signer keypair and add it to the FID via KeyGateway,
 * using a self-signed EIP-712 key request (the wallet acts as both custody
 * and "app" requesting the key).
 *
 * Cost: ~$0.05 of ETH on Optimism for gas.
 *
 * @param {string} privateKey - Custody wallet private key (the one that owns the FID)
 * @returns {Promise<{ signerPublicKey: string, signerPrivateKey: string, txHash: string }>}
 */
async function addSigner(privateKey) {
  const provider = new JsonRpcProvider(RPC.OPTIMISM);
  const wallet = new Wallet(privateKey, provider);

  console.log('Wallet:', wallet.address);

  const idRegistry = new Contract(CONTRACTS.ID_REGISTRY, ABIS.ID_REGISTRY, provider);
  const fid = await idRegistry.idOf(wallet.address);

  if (fid === 0n) {
    throw new Error('No FID registered to this address. Run scripts/register-fid.js first.');
  }
  console.log('FID:', fid.toString());

  const balance = await provider.getBalance(wallet.address);
  console.log('Balance:', formatEther(balance), 'ETH');

  // Generate Ed25519 keypair locally
  const { publicKey, privateKey: signerPrivKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const privateKeyDer = signerPrivKey.export({ type: 'pkcs8', format: 'der' });

  // The DER footers contain the raw 32-byte keys
  const rawPublicKey = publicKeyDer.slice(-32);
  const rawPrivateKey = privateKeyDer.slice(-32);

  const signerPublicKeyHex = rawPublicKey.toString('hex');
  const signerPrivateKeyHex = rawPrivateKey.toString('hex');
  const keyBytes = '0x' + signerPublicKeyHex;

  console.log('\nGenerated signer keypair:');
  console.log('Public Key:', signerPublicKeyHex);

  // Sign the key request — wallet uses its own FID as the requesting "app"
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400); // 24h
  const message = { requestFid: fid, key: keyBytes, deadline };

  console.log('\nSigning EIP-712 key request...');
  const signature = await wallet.signTypedData(
    EIP712.SIGNED_KEY_REQUEST,
    EIP712_TYPES.SIGNED_KEY_REQUEST,
    message
  );

  // Use the validator contract to encode metadata correctly
  const validator = new Contract(
    CONTRACTS.SIGNED_KEY_REQUEST_VALIDATOR,
    ABIS.SIGNED_KEY_REQUEST_VALIDATOR,
    provider
  );
  const metadata = await validator.encodeMetadata([fid, wallet.address, signature, deadline]);
  console.log('Metadata encoded');

  const keyGateway = new Contract(CONTRACTS.KEY_GATEWAY, ABIS.KEY_GATEWAY, wallet);
  console.log('Adding signer key...');
  const tx = await keyGateway.add(
    1, // keyType: ED25519
    keyBytes,
    1, // metadataType: SignedKeyRequest
    metadata,
    { gasLimit: 500000n }
  );

  console.log('Transaction:', tx.hash);
  console.log('Waiting for confirmation...');
  await tx.wait();

  console.log('\nSUCCESS — signer key added.');

  return {
    signerPublicKey: signerPublicKeyHex,
    signerPrivateKey: signerPrivateKeyHex,
    txHash: tx.hash
  };
}

// CLI usage
if (require.main === module) {
  const privateKey = process.env.PRIVATE_KEY || process.argv[2];

  if (!privateKey) {
    console.log('Usage: PRIVATE_KEY=0x... node scripts/add-signer.js');
    process.exit(1);
  }

  addSigner(privateKey)
    .then(({ signerPublicKey, signerPrivateKey, txHash }) => {
      console.log('\n=== Signer Added ===');
      console.log('Signer Public Key:', signerPublicKey);
      console.log('Signer Private Key:', signerPrivateKey);
      console.log('TX:', txHash);
      console.log('\nSAVE THE SIGNER PRIVATE KEY — you need it to post casts.');
    })
    .catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { addSigner };
