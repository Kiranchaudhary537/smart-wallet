import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey('64sQLCxxfgLkTwGGvC8jNq1z4P5H29tTY79EizvpzurH');
export const SOL_MINT = PublicKey.default;
export const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds.map(s => typeof s === 'string' ? Buffer.from(s) : s.toBuffer()), PROGRAM_ID)[0];
export const configAddress = pda('config');
export const programDataAddress = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], LOADER)[0];
export const walletAddress = owner => pda('wallet', owner);
export const vaultAddress = wallet => pda('vault', wallet);
export const delegateAddress = (wallet, delegate, mint = SOL_MINT) => pda('delegate', wallet, delegate, mint);
export const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
export const i64 = n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
export const params = ({ limit = 100, period = 0, expires = 0, recipient = PublicKey.default } = {}) => Buffer.concat([u64(limit), i64(period), i64(expires), recipient.toBuffer()]);
export const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
export const rw = key => meta(key, false, true);
export const signer = (key, writable = false) => meta(key, true, writable);
export const system = meta(SystemProgram.programId);
export function instruction(name, keys, ...args) {
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([createHash('sha256').update(`global:${name}`).digest().subarray(0, 8), ...args]) });
}
export const initializeConfig = admin => instruction('initialize_config', [signer(admin, true), rw(configAddress), meta(PROGRAM_ID), meta(programDataAddress), system]);
