import { writeFileSync, existsSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { loadSigner } from './env.mjs';
if (existsSync('.env')) {
  console.log(`Existing .env preserved. Signer: ${loadSigner().publicKey.toBase58()}`);
} else {
  const wallet = Keypair.generate();
  writeFileSync('.env', `PRIVATE_KEY=${bs58.encode(wallet.secretKey)}\nSOLANA_RPC_URL=https://api.devnet.solana.com\n`, { mode: 0o600, flag: 'wx' });
  console.log(`Devnet signer created in .env (mode 0600). Public key: ${wallet.publicKey.toBase58()}`);
}
