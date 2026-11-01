// Standard SPL Token wire instructions, shared by the legacy and Token-2022 programs.
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { meta, rw, signer, u64 } from '../scripts/client.mjs';
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const MINT_SIZE = 82, ACCOUNT_SIZE = 165;
const tokenIx = (programId, keys, data) => new TransactionInstruction({ programId, keys, data });
export const createInitializeMint2Instruction = (mint, decimals, authority, freezeAuthority, programId) => {
  if (freezeAuthority !== null) throw new Error('Test helper supports no freeze authority only');
  return tokenIx(programId, [rw(mint)], Buffer.concat([Buffer.from([20, decimals]), authority.toBuffer(), Buffer.from([0])]));
};
export const createInitializeAccount3Instruction = (account, mint, owner, programId) => tokenIx(programId, [rw(account), meta(mint)], Buffer.concat([Buffer.from([18]), owner.toBuffer()]));
export const createMintToInstruction = (mint, account, authority, amount, multisigners, programId) => {
  if (multisigners.length) throw new Error('Test helper supports a single authority only');
  return tokenIx(programId, [rw(mint), rw(account), signer(authority)], Buffer.concat([Buffer.from([7]), u64(amount)]));
};
