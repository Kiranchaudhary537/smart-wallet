# Smart Wallet — Design

An Anchor program where every user gets a unique, deterministic wallet address.
The **owner** has full control. **Delegates** (the "selected addresses") get
scoped spending rights: per asset, rate-limited, optionally expiring, and
optionally locked to one recipient.

Built against `anchor-lang` / `anchor-spl` **1.2.2**.

---

## 1. Account model

```
                     Config  PDA ["config"]                       (one, global)
                     ├─ admin, pending_admin
                     └─ paused   ── blocks DELEGATE spending only

  owner ──signs──▶   Wallet  PDA ["wallet", seed_key]             (one per user)
                     ├─ owner, pending_owner
                     ├─ seed_key (original creator, fixed forever)
                     ├─ frozen   ── owner kill switch for delegates
                     └─ delegate_count, bump, vault_bump
                          │
                          ├──▶ Vault  PDA ["vault", wallet]       (holds funds)
                          │     • data-less, system-owned account → holds SOL
                          │     • authority of its token accounts (ATAs)
                          │     • always kept ≥ rent-exempt minimum
                          │
                          └──▶ Delegate PDA ["delegate", wallet, delegate, mint]
                                • one per (delegate, asset); mint = 0x00…00 for SOL
                                • limit_per_period, period_secs, spent_in_period
                                • expires_at, allowed_recipient
```

**Why a separate vault?** Funds sit in a data-less system account instead of
the `Wallet` state account. This keeps lamport accounting separate from
account data, allows plain `system_program::transfer` CPIs signed by PDA seeds,
and lets anyone deposit by simply sending SOL to the vault address or tokens to
the vault's associated token account.

**Unique address per user.** `Wallet = PDA(["wallet", user])`, so the address is
derivable off-chain by anyone, and one user cannot create two wallets.
`seed_key` is frozen at creation, so the address never changes even if the
owner key is rotated later.

## 2. Instructions

| Group | Instruction | Signer | Notes |
|---|---|---|---|
| Platform | `initialize_config` | upgrade authority | One-time; checked against `ProgramData` |
| | `set_paused` | admin | Stops delegate spending globally |
| | `propose_admin` / `accept_admin` | admin / new admin | Two-step rotation |
| Wallet | `create_wallet` | user | Creates wallet + funds vault to rent-exempt |
| | `deposit_sol` | anyone | Convenience; a direct transfer also works |
| | `set_frozen` | owner | Freezes all of this wallet's delegates |
| | `propose_owner` / `accept_owner` | owner / new owner | Key rotation; default key cancels |
| Owner access | `owner_withdraw_sol` / `owner_withdraw_token` | owner | Never blocked by pause or freeze |
| Delegates | `add_delegate` / `update_delegate` / `revoke_delegate` | owner | Revoke closes the PDA, rent returns to owner |
| Delegate access | `delegate_withdraw_sol` / `delegate_withdraw_token` | delegate | Every gate in §3 applies |

## 3. Delegate spend: check order

All checks run before any funds move; a failed check mutates nothing.

1. `config.paused == false` (platform circuit breaker)
2. `wallet.frozen == false` (owner circuit breaker)
3. Delegate PDA re-derived from `(wallet, signer, mint)`, so the signer can only
   use **their own** permission for **this exact asset**
4. Recipient allowlist (for tokens, matched on the destination account's owner)
5. Expiry: `now < expires_at` unless `expires_at == 0`
6. Window rollover, then `spent + amount ≤ limit` with checked math
7. Vault-signed CPI transfer; vault must stay rent-exempt

## 4. Security model

### Trust boundaries
- **Owner**: full control, cannot be overridden by anyone.
- **Platform admin**: can pause delegate spending only. It **cannot move funds,
  cannot block owner withdrawals, and cannot add delegates.** A compromised
  platform key can at worst cause a delegate-spending outage.
- **Delegate**: bounded by limit × window, expiry, asset, and recipient. A stolen
  delegate key can spend each window until expiry, freeze, pause or revocation;
  adjacent fixed windows can each be spent near their shared boundary.

### Threats and mitigations

| Threat | Mitigation |
|---|---|
| Fake or substituted accounts (wallet, vault, delegate, config) | Every PDA re-derived with `seeds` + stored `bump`; `has_one` binds owner/wallet links; Anchor checks discriminators and owners |
| Using another person's allowance | Delegate PDA seeds include `authority.key()`; signer must match |
| Using a SOL allowance on tokens (or vice versa) | Seeds include the mint (`SOL_MINT` for SOL) |
| Missing signer checks | Every authority is `Signer<'info>` |
| Front-running `initialize_config` to steal admin | Requires program upgrade authority via `ProgramData` |
| Admin/owner set to a mistyped key | Two-step propose/accept rotation |
| Overflow / underflow | `checked_*` everywhere + `overflow-checks = true` in release |
| Vault garbage-collected (falls below rent) | Funded to rent-exempt at creation; withdrawals keep it there |
| Lazy resets drifting the fixed-window schedule | Window start is aligned to the original schedule; adjacent windows still allow boundary bursts |
| Wrong token account or wrong mint | `token::mint`, `token::authority = vault`, `token::token_program` constraints; `transfer_checked` enforces decimals |
| Fake token program | `Interface<TokenInterface>` accepts only SPL Token / Token-2022 |
| Account re-initialisation | Only `init` is used, never `init_if_needed` |
| Funds sent to the wallet state account or vault itself | Explicit recipient checks |
| Platform holding funds hostage | Owner withdrawal paths ignore `paused` / `frozen` |
| Stale delegates after key rotation | Delegates survive rotation by design; **after a compromise-driven rotation, freeze and review delegates** |

### Deliberate omissions
- **No `close_wallet`.** The address is derived from the original creator. If a
  rotated wallet were closed, the old key could recreate it at the same address
  and claim any stranded token accounts. The owner can still withdraw
  everything; only about 0.002 SOL of rent stays locked.
- **Token-2022 transfer hooks are not supported.** `transfer_checked` is called
  without the extra hook accounts, so hooked mints will fail safely.

## 5. Recommended next steps before mainnet
1. Integration tests with LiteSVM or Bankrun: every error path, and every
   instruction called with each account swapped for a forged one.
2. Social recovery: guardian set + time-locked `recover_owner`.
3. Optional per-delegate program allowlist (CPI "session keys" for dApps).
4. Move the upgrade authority to a multisig (e.g. Squads); eventually make the
   program immutable or time-lock upgrades.
5. External audit, and publish a `security.txt`.
6. Use `solana-verify` for reproducible, verifiable builds.
