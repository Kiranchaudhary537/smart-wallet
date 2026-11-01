import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { loadSigner } from './env.mjs';
import { PROGRAM_ID, programDataAddress, configAddress, walletAddress, vaultAddress, delegateAddress, SOL_MINT, instruction, params, u64, meta, rw, signer, system } from './client.mjs';

const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const ata = owner => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), USDC.toBuffer()], ASSOCIATED)[0];
const createAta = (payer, owner) => new TransactionInstruction({ programId: ASSOCIATED, keys: [signer(payer, true), rw(ata(owner)), meta(owner), meta(USDC), system, meta(TOKEN)], data: Buffer.from([1]) });
const explorer = signature => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const receiptPath = 'deployments/demo-devnet.json';

async function main() {
  const sponsor = loadSigner();
  const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
  assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', 'Demo is restricted to devnet');
  mkdirSync('.demo', { recursive: true, mode: 0o700 });
  mkdirSync('deployments', { recursive: true });
  const key = name => {
    const path = `.demo/${name}-keypair.json`;
    if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
    const result = Keypair.generate();
    writeFileSync(path, JSON.stringify(Array.from(result.secretKey)), { mode: 0o600, flag: 'wx' });
    return result;
  };
  const owner = key('owner'), delegate = key('delegate');
  const wallet = walletAddress(owner.publicKey), vault = vaultAddress(wallet);
  const delegateWallet = walletAddress(delegate.publicKey), delegateVault = vaultAddress(delegateWallet);
  const source = ata(vault), ownerToken = ata(owner.publicKey), delegateToken = ata(delegate.publicKey);
  const permissionSol = delegateAddress(wallet, delegate.publicKey), permissionUsdc = delegateAddress(wallet, delegate.publicKey, USDC);
  const binary = readFileSync('target/deploy/smart_wallet.so');
  const deployed = await connection.getAccountInfo(programDataAddress);
  assert.ok(deployed.data.subarray(45, 45 + binary.length).equals(binary), 'Deployed program must match the tested local binary');
  const config = await connection.getAccountInfo(configAddress);
  assert.equal(config.data[72], 0, 'Global delegate spending must be unpaused');
  const mint = await connection.getAccountInfo(USDC);
  assert.ok(mint.owner.equals(TOKEN) && mint.data[44] === 6, 'Expected Circle devnet USDC with six decimals');
  const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : {
    version: '0.1.0', cluster: 'devnet', programId: PROGRAM_ID.toBase58(), binarySha256: createHash('sha256').update(binary).digest('hex'),
    sponsor: sponsor.publicKey.toBase58(), owner: owner.publicKey.toBase58(), delegate: delegate.publicKey.toBase58(),
    wallet: wallet.toBase58(), vault: vault.toBase58(), delegateWallet: delegateWallet.toBase58(), delegateVault: delegateVault.toBase58(),
    usdcMint: USDC.toBase58(), vaultUsdcAccount: source.toBase58(), ownerUsdcAccount: ownerToken.toBase58(), delegateUsdcAccount: delegateToken.toBase58(),
    permissions: { sol: permissionSol.toBase58(), usdc: permissionUsdc.toBase58(), solLimitLamports: '20000000', usdcLimitBaseUnits: '2000000', periodSeconds: 86400, expiresAt: Math.floor(Date.now()/1000)+86400, allowedRecipient: delegate.publicKey.toBase58() },
    startedAt: new Date().toISOString(), transactions: []
  };
  assert.equal(receipt.owner, owner.publicKey.toBase58(), 'Keep original demo keys when resuming');
  assert.equal(receipt.delegate, delegate.publicKey.toBase58());
  const save = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  if (receipt.completedAt) { console.log('Demo already completed; no new transfers made. See', receiptPath); return; }
  save();
  const step = async (name, instructions, payer, extra = []) => {
    if (receipt.transactions.some(t => t.name === name)) return;
    const transaction = new Transaction().add(...instructions);
    transaction.feePayer = payer.publicKey;
    const keys = [...new Map([payer, ...extra].map(k => [k.publicKey.toBase58(), k])).values()];
    const signature = await sendAndConfirmTransaction(connection, transaction, keys, { commitment: 'confirmed' });
    receipt.transactions.push({ name, signature, explorer: explorer(signature), feePayer: payer.publicKey.toBase58(), instructionCount: instructions.length, confirmedAt: new Date().toISOString() });
    save(); console.log(name, signature);
  };
  const accounts = await connection.getParsedTokenAccountsByOwner(sponsor.publicKey, { mint: USDC });
  const funded = accounts.value.find(a => BigInt(a.account.data.parsed.info.tokenAmount.amount) >= 5_000_000n);
  if (!receipt.transactions.some(t => t.name === 'fund_user_vault') && !funded) throw new Error('Sponsor needs at least 5 Circle devnet USDC in one token account.');
  await step('fund_participant_signers', [SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: owner.publicKey, lamports: 50_000_000 }), SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: delegate.publicKey, lamports: 30_000_000 })], sponsor);
  const createWallet = (authority, state, funds) => instruction('create_wallet', [signer(authority, true), rw(state), rw(funds), system]);
  await step('create_user_wallet', [createWallet(owner.publicKey, wallet, vault)], owner);
  await step('create_delegate_wallet', [createWallet(delegate.publicKey, delegateWallet, delegateVault)], delegate);
  await step('create_usdc_accounts', [createAta(sponsor.publicKey, vault), createAta(sponsor.publicKey, owner.publicKey), createAta(sponsor.publicKey, delegate.publicKey)], sponsor);
  if (!receipt.transactions.some(t => t.name === 'fund_user_vault')) {
    await step('fund_user_vault', [SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: vault, lamports: 100_000_000 }), new TransactionInstruction({ programId: TOKEN, keys: [rw(funded.pubkey), meta(USDC), rw(source), signer(sponsor.publicKey)], data: Buffer.concat([Buffer.from([12]), u64(5_000_000), Buffer.from([6])]) })], sponsor);
  }
  const addPermission = (mintKey, address, limit) => instruction('add_delegate', [signer(owner.publicKey, true), rw(wallet), rw(address), system], delegate.publicKey.toBuffer(), mintKey.toBuffer(), params({ limit, period: 86400, expires: receipt.permissions.expiresAt, recipient: delegate.publicKey }));
  await step('authorize_delegate', [addPermission(SOL_MINT, permissionSol, 20_000_000), addPermission(USDC, permissionUsdc, 2_000_000)], owner);
  const balance = async () => ({ vaultLamports: String(await connection.getBalance(vault)), vaultUsdcBaseUnits: (await connection.getTokenAccountBalance(source)).value.amount, ownerLamports: String(await connection.getBalance(owner.publicKey)), ownerUsdcBaseUnits: (await connection.getTokenAccountBalance(ownerToken)).value.amount, delegateLamports: String(await connection.getBalance(delegate.publicKey)), delegateUsdcBaseUnits: (await connection.getTokenAccountBalance(delegateToken)).value.amount });
  if (!receipt.beforeAccess) { receipt.beforeAccess = await balance(); save(); }
  const ownerSol = instruction('owner_withdraw_sol', [signer(owner.publicKey), meta(wallet), rw(vault), rw(owner.publicKey), system], u64(10_000_000));
  const ownerUsdc = instruction('owner_withdraw_token', [signer(owner.publicKey), meta(wallet), meta(vault), meta(USDC), rw(source), rw(ownerToken), meta(TOKEN)], u64(1_000_000));
  await step('owner_access_1_transaction', [ownerSol, ownerUsdc], owner);
  await step('delegate_access_1_sol', [instruction('delegate_withdraw_sol', [signer(delegate.publicKey), meta(configAddress), meta(wallet), rw(permissionSol), rw(vault), rw(delegate.publicKey), system], u64(5_000_000))], delegate);
  await step('delegate_access_2_usdc', [instruction('delegate_withdraw_token', [signer(delegate.publicKey), meta(configAddress), meta(wallet), rw(permissionUsdc), meta(vault), meta(USDC), rw(source), rw(delegateToken), meta(TOKEN)], u64(500_000))], delegate);
  receipt.afterAccess = await balance();
  assert.equal(BigInt(receipt.beforeAccess.vaultLamports)-BigInt(receipt.afterAccess.vaultLamports), 15_000_000n);
  assert.equal(BigInt(receipt.beforeAccess.vaultUsdcBaseUnits)-BigInt(receipt.afterAccess.vaultUsdcBaseUnits), 1_500_000n);
  assert.equal(BigInt(receipt.afterAccess.ownerUsdcBaseUnits)-BigInt(receipt.beforeAccess.ownerUsdcBaseUnits), 1_000_000n);
  assert.equal(BigInt(receipt.afterAccess.delegateUsdcBaseUnits)-BigInt(receipt.beforeAccess.delegateUsdcBaseUnits), 500_000n);
  for (const name of ['owner_access_1_transaction', 'delegate_access_1_sol', 'delegate_access_2_usdc']) {
    const row = receipt.transactions.find(t => t.name === name);
    const transaction = await connection.getTransaction(row.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    assert.ok(transaction && transaction.meta.err === null, 'Access transaction must be confirmed and successful');
    row.feeLamports = transaction.meta.fee;
    row.slot = transaction.slot;
  }
  const access = name => receipt.transactions.find(t => t.name === name);
  assert.equal(BigInt(receipt.afterAccess.ownerLamports)-BigInt(receipt.beforeAccess.ownerLamports), 10_000_000n-BigInt(access('owner_access_1_transaction').feeLamports));
  assert.equal(BigInt(receipt.afterAccess.delegateLamports)-BigInt(receipt.beforeAccess.delegateLamports), 5_000_000n-BigInt(access('delegate_access_1_sol').feeLamports)-BigInt(access('delegate_access_2_usdc').feeLamports));
  for (const [address, expected] of [[permissionSol, 5_000_000n], [permissionUsdc, 500_000n]]) {
    assert.equal((await connection.getAccountInfo(address)).data.readBigUInt64LE(160), expected);
  }
  receipt.completedAt = new Date().toISOString(); save();
  console.log('Verified demo: one owner access transaction; two delegate access transactions. Receipt:', receiptPath);
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
