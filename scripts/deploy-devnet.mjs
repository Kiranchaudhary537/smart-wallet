import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { loadSigner } from './env.mjs';
import { PROGRAM_ID, LOADER, programDataAddress, configAddress, initializeConfig } from './client.mjs';
async function main() {
  const signer = loadSigner();
  const rpc = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpc, 'confirmed');
  // Check the chain, even when a custom RPC URL is used.
  if (await connection.getGenesisHash() !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('Deployment is restricted to Solana devnet.');
  const programKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('target/deploy/smart_wallet-keypair.json', 'utf8'))));
  if (!programKey.publicKey.equals(PROGRAM_ID)) throw new Error('Program keypair does not match scripts/client.mjs. Do not regenerate a deployed program keypair.');
  const binary = readFileSync('target/deploy/smart_wallet.so');
  const balance = await connection.getBalance(signer.publicKey);
  const rent = await connection.getMinimumBalanceForRentExemption(binary.length + 45);
  const existingData = await connection.getAccountInfo(programDataAddress);
  const bufferPath = 'target/deploy/smart_wallet-buffer.json';
  const bufferKey = existsSync(bufferPath) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(bufferPath, 'utf8')))) : Keypair.generate();
  const bufferRent = await connection.getMinimumBalanceForRentExemption(binary.length + 37);
  const bufferBalance = await connection.getBalance(bufferKey.publicKey);
  const required = Math.max(0, rent - (existingData?.lamports || 0)) + Math.max(0, bufferRent - bufferBalance) + 50_000_000;
  console.log(`Devnet payer: ${signer.publicKey}; balance: ${balance / 1e9} SOL; program: ${PROGRAM_ID}`);
  if (balance < required) throw new Error(`Insufficient devnet SOL. Fund ${signer.publicKey} with at least ${((required - balance) / 1e9).toFixed(3)} more SOL, then rerun npm run deploy:devnet.`);
  if (!existsSync(bufferPath)) writeFileSync(bufferPath, JSON.stringify(Array.from(bufferKey.secretKey)), { mode: 0o600, flag: 'wx' });
  const dir = mkdtempSync(join(tmpdir(), 'smart-wallet-'));
  try {
    const keyfile = join(dir, 'payer.json');
    writeFileSync(keyfile, JSON.stringify(Array.from(signer.secretKey)), { mode: 0o600 });
    const result = spawnSync('solana', ['program', 'deploy', '--url', rpc, '--keypair', keyfile, '--upgrade-authority', keyfile, '--buffer', bufferPath, '--program-id', 'target/deploy/smart_wallet-keypair.json', 'target/deploy/smart_wallet.so'], { stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error('Solana deployment failed.');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const deployed = await connection.getAccountInfo(PROGRAM_ID);
  if (!deployed?.executable || !deployed.owner.equals(LOADER)) throw new Error('Deployment verification failed: program is not an upgradeable executable.');
  const programData = await connection.getAccountInfo(programDataAddress);
  if (!programData?.owner.equals(LOADER) || !programData.data.subarray(45, 45 + binary.length).equals(binary)) throw new Error('Deployed program bytes differ from the local binary.');
  let initializationSignature = null;
  if (!await connection.getAccountInfo(configAddress)) {
    initializationSignature = await sendAndConfirmTransaction(connection, new Transaction().add(initializeConfig(signer.publicKey)), [signer]);
  }
  const config = await connection.getAccountInfo(configAddress);
  if (!config?.owner.equals(PROGRAM_ID) || !config.data.subarray(0, 8).equals(createHash('sha256').update('account:Config').digest().subarray(0, 8))) throw new Error('Config account verification failed.');
  const admin = new PublicKey(config.data.subarray(8, 40)).toBase58();
  const receipt = { cluster: 'devnet', programId: PROGRAM_ID.toBase58(), payer: signer.publicKey.toBase58(), config: configAddress.toBase58(), admin, initializationSignature, binarySha256: createHash('sha256').update(binary).digest('hex'), verifiedAt: new Date().toISOString(), explorer: `https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet` };
  mkdirSync('deployments', { recursive: true });
  writeFileSync('deployments/devnet.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
