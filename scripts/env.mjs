import { config } from 'dotenv';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
config({ quiet: true });
export function loadSigner() {
  const value = process.env.PRIVATE_KEY;
  if (!value) throw new Error('PRIVATE_KEY is missing. Run npm run wallet:setup or set it in .env.');
  try {
    return Keypair.fromSecretKey(value.trim().startsWith('[') ? Uint8Array.from(JSON.parse(value)) : bs58.decode(value.trim()));
  } catch { throw new Error('PRIVATE_KEY must be a base58 or JSON-encoded 64-byte Solana secret key.'); }
}
