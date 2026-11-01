import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import { getTransactionDecoder } from '@solana/kit';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, MINT_SIZE, ACCOUNT_SIZE, createInitializeMint2Instruction, createInitializeAccount3Instruction, createMintToInstruction } from './token-helpers.mjs';
import { PROGRAM_ID, LOADER, configAddress, programDataAddress, walletAddress, vaultAddress, delegateAddress, SOL_MINT, initializeConfig, instruction as ix, params, u64, meta, rw, signer, system } from '../scripts/client.mjs';

const binary = readFileSync(new URL('../target/deploy/smart_wallet.so', import.meta.url));
function fixture({ initialize = true } = {}) {
  const svm = new LiteSVM().withTransactionHistory(0n);
  const clock = svm.getClock(); clock.unixTimestamp = 1_000_000n; svm.setClock(clock);
  const admin = Keypair.generate(), owner = Keypair.generate(), delegate = Keypair.generate(), recipient = Keypair.generate(), stranger = Keypair.generate();
  for (const k of [admin, owner, delegate, recipient, stranger]) svm.airdrop(k.publicKey.toBase58(), 10_000_000_000n);
  svm.addProgramWithLoader(PROGRAM_ID.toBase58(), binary, LOADER.toBase58());
  // LiteSVM installs the executable; configure its real loader metadata with an upgrade authority.
  const dataAccount = svm.getAccount(programDataAddress.toBase58());
  const data = Buffer.from(dataAccount.data);
  data[12] = 1;
  admin.publicKey.toBuffer().copy(data, 13);
  svm.setAccount({ ...dataAccount, data });
  const wallet = walletAddress(owner.publicKey), vault = vaultAddress(wallet);
  const permission = (mint = SOL_MINT, authority = delegate.publicKey) => delegateAddress(wallet, authority, mint);
  const send = (instructions, authority = owner, error) => {
    const tx = new Transaction({ feePayer: admin.publicKey, recentBlockhash: svm.latestBlockhash() }).add(...[instructions].flat());
    tx.sign(...[...new Map([admin, ...[authority].flat()].map(k => [k.publicKey.toBase58(), k])).values()]);
    const result = svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()));
    if (error) {
      assert.ok(result instanceof FailedTransactionMetadata, `Expected ${error}, transaction succeeded`);
      assert.match(result.meta().logs().join('\n'), new RegExp(`Error Code: ${error}\\.`));
    } else assert.ok(!(result instanceof FailedTransactionMetadata), result.toString());
    return result;
  };
  const account = key => svm.getAccount(key.toBase58());
  const bytes = key => Buffer.from(account(key).data);
  const balance = key => svm.getBalance(key.toBase58());
  const add = (options = {}, mint = SOL_MINT) => ix('add_delegate', [signer(owner.publicKey, true), rw(wallet), rw(permission(mint)), system], delegate.publicKey.toBuffer(), mint.toBuffer(), params(options));
  const spend = (amount, target = recipient.publicKey, authority = delegate, permissionKey = permission()) => ix('delegate_withdraw_sol', [signer(authority.publicKey), meta(configAddress), meta(wallet), rw(permissionKey), rw(vault), rw(target), system], u64(amount));
  const withdraw = (amount, target = recipient.publicKey, authority = owner) => ix('owner_withdraw_sol', [signer(authority.publicKey), meta(wallet), rw(vault), rw(target), system], u64(amount));
  const freeze = value => ix('set_frozen', [signer(owner.publicKey), rw(wallet)], Buffer.from([+value]));
  const pause = value => ix('set_paused', [signer(admin.publicKey), rw(configAddress)], Buffer.from([+value]));
  const update = options => ix('update_delegate', [signer(owner.publicKey), meta(wallet), rw(permission())], params(options));
  const now = () => svm.getClock().unixTimestamp;
  const advance = seconds => { const clock = svm.getClock(); clock.unixTimestamp += BigInt(seconds); svm.setClock(clock); };
  if (initialize) send(initializeConfig(admin.publicKey), admin);
  send(ix('create_wallet', [signer(owner.publicKey, true), rw(wallet), rw(vault), system]));
  send(ix('deposit_sol', [signer(owner.publicKey, true), meta(wallet), rw(vault), system], u64(100_000_000)));
  return { svm, admin, owner, delegate, recipient, stranger, wallet, vault, permission, send, account, bytes, balance, add, spend, withdraw, freeze, pause, update, now, advance };
}

test('creates deterministic wallet, initializes admin, and accepts third-party deposits', () => {
  const f = fixture();
  assert.deepEqual(f.bytes(f.wallet).subarray(8, 40), f.owner.publicKey.toBuffer());
  assert.deepEqual(f.bytes(configAddress).subarray(8, 40), f.admin.publicKey.toBuffer());
  const before = f.balance(f.vault);
  f.send(ix('deposit_sol', [signer(f.stranger.publicKey, true), meta(f.wallet), rw(f.vault), system], u64(12)), f.stranger);
  assert.equal(f.balance(f.vault), before + 12n);
  f.send(ix('deposit_sol', [signer(f.owner.publicKey, true), meta(f.wallet), rw(f.vault), system], u64(0)), f.owner, 'ZeroAmount');
});

test('rejects unauthorized owners, zero withdrawals, self transfers and draining rent', () => {
  const f = fixture();
  f.send(f.withdraw(1, f.recipient.publicKey, f.stranger), f.stranger, 'Unauthorized');
  f.send(f.withdraw(0), f.owner, 'ZeroAmount');
  f.send(f.withdraw(1, f.vault), f.owner, 'InvalidRecipient');
  f.send(f.withdraw(1, f.wallet), f.owner, 'InvalidRecipient');
  f.send(f.withdraw(f.balance(f.vault)), f.owner, 'InsufficientFunds');
  const before = f.balance(f.recipient.publicKey);
  f.send(f.withdraw(200));
  assert.equal(f.balance(f.recipient.publicKey), before + 200n);
});

test('enforces lifetime caps and recipient lock; failed transactions roll back spending', () => {
  const f = fixture();
  f.send(f.add({ limit: 100, recipient: f.recipient.publicKey }));
  const before = f.balance(f.recipient.publicKey);
  f.send(f.spend(60), f.delegate);
  f.send(f.spend(1, f.stranger.publicKey), f.delegate, 'RecipientNotAllowed');
  f.send(f.spend(41), f.delegate, 'LimitExceeded');
  assert.equal(f.bytes(f.permission()).readBigUInt64LE(160), 60n);
  f.send(f.spend(40), f.delegate);
  f.advance(100000);
  f.send(f.spend(1), f.delegate, 'LimitExceeded');
  assert.equal(f.balance(f.recipient.publicKey), before + 100n);
});

test('rolls periodic windows and rejects expired delegates at the exact boundary', () => {
  const f = fixture();
  f.send(f.add({ limit: 100, period: 60, expires: f.now() + 180n }));
  f.send(f.spend(100), f.delegate);
  f.advance(59);
  f.send(f.spend(1), f.delegate, 'LimitExceeded');
  f.advance(1);
  f.send(f.spend(100), f.delegate);
  f.advance(120);
  f.send(f.spend(1), f.delegate, 'DelegateExpired');
});

test('pause and freeze block delegates while owner withdrawals stay available', () => {
  const f = fixture(); f.send(f.add());
  f.send(f.pause(true), f.admin);
  f.send(f.spend(1), f.delegate, 'ProgramPaused');
  f.send(f.withdraw(1));
  f.send(f.pause(false), f.admin);
  f.send(f.freeze(true));
  f.send(f.spend(1), f.delegate, 'WalletFrozen');
  f.send(f.withdraw(1));
  f.send(f.freeze(false)); f.send(f.spend(1), f.delegate);
});

test('updates retain spent amounts; revocation closes permission and refunds rent', () => {
  const f = fixture(); f.send(f.add()); f.send(f.spend(60), f.delegate);
  f.send(f.update({ limit: 50 }));
  f.send(f.spend(1), f.delegate, 'LimitExceeded');
  f.send(f.update({ limit: 70 })); f.send(f.spend(10), f.delegate);
  const rent = f.balance(f.permission()), ownerBefore = f.balance(f.owner.publicKey);
  f.send(ix('revoke_delegate', [signer(f.owner.publicKey, true), rw(f.wallet), rw(f.permission())]));
  assert.equal(f.account(f.permission()).exists, false);
  assert.equal(f.balance(f.owner.publicKey), ownerBefore + rent);
  assert.equal(f.bytes(f.wallet).readUInt32LE(105), 0);
  f.send(f.spend(1), f.delegate, 'AccountNotInitialized');
});

test('rejects invalid delegate parameters and signer/account substitutions', () => {
  const f = fixture();
  for (const options of [{ limit: 0 }, { period: -1 }, { period: 31536001 }, { expires: f.now() }]) f.send(f.add(options), f.owner, 'InvalidDelegateParams');
  f.send(f.add());
  f.send(f.spend(1, f.recipient.publicKey, f.stranger), f.stranger, 'ConstraintSeeds');
  const before = f.bytes(f.permission());
  f.send(f.spend(100_000_001), f.delegate, 'LimitExceeded');
  assert.deepEqual(f.bytes(f.permission()), before);
  f.send(f.update({ limit: 1_000_000_000 }));
  const checkpoint = f.bytes(f.permission());
  f.send(f.spend(100_000_001), f.delegate, 'InsufficientFunds');
  assert.deepEqual(f.bytes(f.permission()), checkpoint);
});

test('two-step owner rotation retains PDA and delegates, rejects the old owner', () => {
  const f = fixture(); f.send(f.add());
  f.send(ix('propose_owner', [signer(f.owner.publicKey), rw(f.wallet)], f.stranger.publicKey.toBuffer()));
  f.send(ix('accept_owner', [signer(f.delegate.publicKey), rw(f.wallet)]), f.delegate, 'NoPendingTransfer');
  f.send(ix('accept_owner', [signer(f.stranger.publicKey), rw(f.wallet)]), f.stranger);
  assert.deepEqual(f.bytes(f.wallet).subarray(8, 40), f.stranger.publicKey.toBuffer());
  assert.deepEqual(f.bytes(f.wallet).subarray(72, 104), f.owner.publicKey.toBuffer());
  f.send(f.withdraw(1), f.owner, 'Unauthorized');
  f.send(f.withdraw(1, f.recipient.publicKey, f.stranger), f.stranger);
  f.send(f.spend(1), f.delegate);
});

test('two-step admin rotation and initialization authority are enforced', () => {
  const f = fixture();
  f.send(ix('set_paused', [signer(f.stranger.publicKey), rw(configAddress)], Buffer.from([1])), f.stranger, 'Unauthorized');
  f.send(ix('propose_admin', [signer(f.admin.publicKey), rw(configAddress)], f.stranger.publicKey.toBuffer()), f.admin);
  f.send(ix('accept_admin', [signer(f.delegate.publicKey), rw(configAddress)]), f.delegate, 'NoPendingTransfer');
  f.send(ix('accept_admin', [signer(f.stranger.publicKey), rw(configAddress)]), f.stranger);
  f.send(f.pause(true), f.admin, 'Unauthorized');
  f.send(ix('set_paused', [signer(f.stranger.publicKey), rw(configAddress)], Buffer.from([1])), f.stranger);
  assert.deepEqual(f.bytes(configAddress).subarray(8, 40), f.stranger.publicKey.toBuffer());
});

for (const tokenProgram of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
  test(`token transfers, recipient owner lock and mint isolation (${tokenProgram})`, () => {
    const f = fixture();
    const mint = Keypair.generate(), source = Keypair.generate(), destination = Keypair.generate(), wrong = Keypair.generate();
    const createAccount = (key, space) => SystemProgram.createAccount({ fromPubkey: f.admin.publicKey, newAccountPubkey: key.publicKey, lamports: Number(f.svm.minimumBalanceForRentExemption(BigInt(space))), space, programId: tokenProgram });
    f.send([createAccount(mint, MINT_SIZE), createInitializeMint2Instruction(mint.publicKey, 6, f.admin.publicKey, null, tokenProgram)], [f.admin, mint]);
    for (const [account, authority] of [[source, f.vault], [destination, f.recipient.publicKey], [wrong, f.stranger.publicKey]]) {
      f.send([createAccount(account, ACCOUNT_SIZE), createInitializeAccount3Instruction(account.publicKey, mint.publicKey, authority, tokenProgram)], [f.admin, account]);
    }
    f.send(createMintToInstruction(mint.publicKey, source.publicKey, f.admin.publicKey, 1000, [], tokenProgram), f.admin);
    f.send(f.add({ limit: 100, recipient: f.recipient.publicKey }, mint.publicKey));
    const spendToken = (amount, target = destination.publicKey, permission = f.permission(mint.publicKey)) => ix('delegate_withdraw_token', [signer(f.delegate.publicKey), meta(configAddress), meta(f.wallet), rw(permission), meta(f.vault), meta(mint.publicKey), rw(source.publicKey), rw(target), meta(tokenProgram)], u64(amount));
    f.send(spendToken(20, wrong.publicKey), f.delegate, 'RecipientNotAllowed');
    f.send(spendToken(60), f.delegate);
    f.send(spendToken(41), f.delegate, 'LimitExceeded');
    f.send(f.spend(1, f.recipient.publicKey, f.delegate, f.permission(mint.publicKey)), f.delegate, 'ConstraintSeeds');
    f.send(ix('update_delegate', [signer(f.owner.publicKey), meta(f.wallet), rw(f.permission(mint.publicKey))], params({ limit: 2000, recipient: f.recipient.publicKey })));
    const permissionBefore = f.bytes(f.permission(mint.publicKey));
    f.send(spendToken(1001), f.delegate, 'InsufficientFunds');
    assert.deepEqual(f.bytes(f.permission(mint.publicKey)), permissionBefore);
    f.send(f.freeze(true));
    f.send(spendToken(1), f.delegate, 'WalletFrozen');
    f.send(f.pause(true), f.admin);
    f.send(spendToken(1), f.delegate, 'ProgramPaused');
    const ownerToken = (amount, target = destination.publicKey) => ix('owner_withdraw_token', [signer(f.owner.publicKey), meta(f.wallet), meta(f.vault), meta(mint.publicKey), rw(source.publicKey), rw(target), meta(tokenProgram)], u64(amount));
    f.send(ownerToken(0), f.owner, 'ZeroAmount');
    // Anchor 1.2.2 rejects aliasing mutable token accounts before the handler.
    f.send(ownerToken(1, source.publicKey), f.owner, 'ConstraintDuplicateMutableAccount');
    f.send(ownerToken(1001), f.owner, 'InsufficientFunds');
    f.send(ownerToken(40));
    assert.equal(f.bytes(destination.publicKey).readBigUInt64LE(64), 100n);
    assert.equal(f.bytes(source.publicKey).readBigUInt64LE(64), 900n);
  });
}


test('config initialization rejects front-running and cannot be repeated', () => {
  const f = fixture({ initialize: false });
  f.send(initializeConfig(f.stranger.publicKey), f.stranger, 'Unauthorized');
  assert.equal(f.account(configAddress).exists, false);
  f.send(initializeConfig(f.admin.publicKey), f.admin);
  const result = f.svm.getAccount(configAddress.toBase58());
  assert.equal(result.exists, true);
  // The init constraint must fail even for the legitimate authority on a second call.
  const tx = new Transaction({ feePayer: f.admin.publicKey, recentBlockhash: f.svm.latestBlockhash() }).add(initializeConfig(f.admin.publicKey));
  tx.sign(f.admin);
  assert.ok(f.svm.sendTransaction(getTransactionDecoder().decode(tx.serialize())) instanceof FailedTransactionMetadata);
});

test('rejects invalid delegate identities and duplicate wallet creation', () => {
  const f = fixture();
  for (const key of [PublicKey.default, f.owner.publicKey, f.wallet, f.vault]) {
    const permission = delegateAddress(f.wallet, key);
    f.send(ix('add_delegate', [signer(f.owner.publicKey, true), rw(f.wallet), rw(permission), system], key.toBuffer(), SOL_MINT.toBuffer(), params()), f.owner, 'InvalidDelegate');
  }
  const tx = new Transaction({ feePayer: f.admin.publicKey, recentBlockhash: f.svm.latestBlockhash() }).add(ix('create_wallet', [signer(f.owner.publicKey, true), rw(f.wallet), rw(f.vault), system]));
  tx.sign(f.admin, f.owner);
  assert.ok(f.svm.sendTransaction(getTransactionDecoder().decode(tx.serialize())) instanceof FailedTransactionMetadata);
});

test('owner/admin proposals can be canceled without changing current authority', () => {
  const f = fixture();
  for (const key of [f.stranger.publicKey, PublicKey.default]) {
    f.send(ix('propose_owner', [signer(f.owner.publicKey), rw(f.wallet)], key.toBuffer()));
    f.send(ix('propose_admin', [signer(f.admin.publicKey), rw(configAddress)], key.toBuffer()), f.admin);
  }
  f.send(ix('accept_owner', [signer(f.stranger.publicKey), rw(f.wallet)]), f.stranger, 'NoPendingTransfer');
  f.send(ix('accept_admin', [signer(f.stranger.publicKey), rw(configAddress)]), f.stranger, 'NoPendingTransfer');
  f.send(f.withdraw(1)); f.send(f.pause(true), f.admin);
});

test('rejects forged vault and cross-wallet delegate accounts', () => {
  const f = fixture(); f.send(f.add());
  const otherWallet = walletAddress(f.stranger.publicKey), otherVault = vaultAddress(otherWallet);
  f.send(ix('create_wallet', [signer(f.stranger.publicKey, true), rw(otherWallet), rw(otherVault), system]), f.stranger);
  f.send(ix('owner_withdraw_sol', [signer(f.owner.publicKey), meta(f.wallet), rw(otherVault), rw(f.recipient.publicKey), system], u64(1)), f.owner, 'ConstraintSeeds');
  f.send(ix('delegate_withdraw_sol', [signer(f.delegate.publicKey), meta(configAddress), meta(otherWallet), rw(f.permission()), rw(otherVault), rw(f.recipient.publicKey), system], u64(1)), f.delegate, 'ConstraintSeeds');
});
