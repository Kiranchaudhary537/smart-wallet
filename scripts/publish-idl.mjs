import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Connection } from '@solana/web3.js';
import { loadSigner } from './env.mjs';
import { PROGRAM_ID } from './client.mjs';

async function main() {
  const payer = loadSigner();
  const rpc = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  if (await new Connection(rpc).getGenesisHash() !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('IDL publication is restricted to devnet.');
  const source = readFileSync('idl.json');
  const idl = JSON.parse(source);
  assert.equal(idl.address, PROGRAM_ID.toBase58(), 'IDL address must match the deployed program');
  const directory = mkdtempSync(join(tmpdir(), 'smart-wallet-idl-'));
  try {
    const keyfile = join(directory, 'payer.json');
    const fetched = join(directory, 'fetched-idl.json');
    writeFileSync(keyfile, JSON.stringify(Array.from(payer.secretKey)), { mode: 0o600 });
    const run = args => {
      const result = spawnSync('npx', ['--yes', '@solana-program/program-metadata@latest', ...args, '--rpc', rpc, '--keypair', keyfile], { stdio: 'inherit' });
      if (result.error || result.status !== 0) throw new Error('Program metadata command failed.');
    };
    run(['write', 'idl', PROGRAM_ID.toBase58(), './idl.json', '--format', 'json']);
    run(['fetch', 'idl', PROGRAM_ID.toBase58(), '--output', fetched]);
    assert.deepEqual(JSON.parse(readFileSync(fetched, 'utf8')), idl, 'Fetched IDL must match the local IDL');
    const receipt = { cluster: 'devnet', programId: PROGRAM_ID.toBase58(), seed: 'idl', file: 'idl.json', sha256: createHash('sha256').update(source).digest('hex'), verifiedAt: new Date().toISOString(), instructionCount: idl.instructions.length };
    writeFileSync('deployments/idl-devnet.json', JSON.stringify(receipt, null, 2) + '\n');
    console.log('Published IDL and verified fetched contents:', JSON.stringify(receipt));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
