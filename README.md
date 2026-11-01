# Smart Wallet

An Anchor 1.2.2 Solana program that gives each creator a deterministic wallet
and a separate vault for SOL and tokens. The owner controls funds and can grant
other addresses limited spending permissions for individual assets.

Delegates can have a lifetime cap or a recurring spending window, an expiry,
and a recipient restriction. The owner can freeze all delegates for their wallet;
the platform admin can pause delegates globally. Neither control blocks owner
withdrawals. Ownership and platform administration both use two-step rotation.

## Account model

| Account | PDA seeds | Purpose |
| --- | --- | --- |
| Config | `"config"` | Global admin and delegate pause switch |
| Wallet | `"wallet", original_creator` | Owner, pending owner, freeze switch, delegate count |
| Vault | `"vault", wallet` | System-owned SOL account and authority for token accounts |
| Delegate | `"delegate", wallet, delegate_signer, mint` | One spending permission per wallet, signer and asset |

For SOL, the mint seed is the all-zero public key (`11111111111111111111111111111111`).
Amounts are integer lamports or token base units; do not use floating-point amounts.
Wallet and vault addresses stay unchanged after owner rotation because the original
creator remains the seed. Existing delegates survive rotation.

Send SOL to the **vault**, or call `deposit_sol`. Send tokens to a token account
whose authority is the vault (normally its associated token account). Token
accounts must be created separately; allow an off-curve owner when deriving the
vault ATA. The program does not provide a token deposit instruction.

## Requirements and setup

- Node.js 22 or newer and npm.
- Rust 1.89.0, pinned in `rust-toolchain.toml`.
- Solana CLI. `npm run tools:setup` installs `cargo-build-sbf` 4.0.0 locally in
  `.tools/` to support the current `sbpf` targets, without replacing global tools.
  The build downloads platform tools v1.54 (Rust 1.89.0); the first build needs
  GitHub download access.
- Anchor CLI **1.2.2** only if you want Anchor-specific commands/IDL generation.
  The npm build, tests and deployment scripts do not require the Anchor CLI.

```sh
npm ci
rustup toolchain install 1.89.0 --profile minimal
npm run tools:setup
npm run build
npm run test:unit
npm test
```

`npm run build` produces `target/deploy/smart_wallet.so`. The integration suite
executes this binary in LiteSVM. Rebuild after changing Rust source. Neither local
test command requires `.env`, a validator, an RPC server, or real funds.

## Environment and keys

```sh
npm run wallet:setup
```

This creates a dedicated devnet signer in `.env` with file permissions `0600`.
It preserves an existing `.env` and prints only the public address. You can instead
copy `.env.example` and set:

```dotenv
PRIVATE_KEY=<base58-encoded 64-byte Solana secret key>
SOLANA_RPC_URL=https://api.devnet.solana.com
```

A JSON array containing the 64 secret-key bytes is also accepted. Secret keys,
`.env`, temporary payer files, build artifacts, and program keypairs are ignored
by Git. Keep `.env` and the program keypair backed up privately. Deployment writes
the payer to a temporary `0600` keypair file for the CLI and removes it afterward.
An ignored buffer keypair in `target/deploy/smart_wallet-buffer.json` allows retrying
an interrupted upload without losing access to its buffer.

The **payer/upgrade-authority key** in `.env` is distinct from the **program identity
keypair** at `target/deploy/smart_wallet-keypair.json`. Keep the latter to deploy this
program address. Do not regenerate it for upgrades. A fresh checkout needs the
original identity keypair restored privately, or a newly generated identity with
all program IDs updated together in `lib.rs`, `Anchor.toml`, and `scripts/client.mjs`.

## Deploy to devnet

The configured program address is
`64sQLCxxfgLkTwGGvC8jNq1z4P5H29tTY79EizvpzurH`.
The program is deployed on [Solana devnet](https://explorer.solana.com/address/64sQLCxxfgLkTwGGvC8jNq1z4P5H29tTY79EizvpzurH?cluster=devnet).
Verified deployment details are recorded in `deployments/devnet.json`.

1. Set a funded devnet key in `.env` or fund the public address printed by
   `npm run wallet:setup`. A fresh deployment generally needs several devnet SOL;
   the script checks program and temporary buffer rent plus a fee margin.
2. Build and test:

   ```sh
   npm run build
   npm run test:unit
   npm test
   ```

3. Deploy and initialize the global config:

   ```sh
   npm run deploy:devnet
   ```

For the current binary, a new deployment preflight estimates about 3.97 devnet SOL
including temporary upload buffer rent and fees. The exact estimate changes with
binary size; temporary buffer rent is reclaimed by a successful deployment.

The script verifies the RPC genesis hash is **devnet**, validates the program
keypair, checks payer funds, deploys through the Solana CLI, confirms that the
program is executable, and initializes config using the upgrade authority if
config does not exist. It records public addresses, the binary SHA-256 hash,
verification time and initialization signature in `deployments/devnet.json`.
An existing config is preserved on upgrades; its admin may differ from the payer.

`initialize_config` requires the deployed program's upgrade authority. Initialize
before giving up that authority. The first initialization makes that signer the
platform admin. The admin can subsequently rotate independently.

The Anchor provider defaults to localnet. Use the explicit npm devnet command
above to load `.env`; `anchor deploy` does not load this project's `.env` signer.

## Published IDL

`idl.json` contains the generated Anchor interface for all 16 instructions and
three state accounts. To regenerate it after interface changes, use a compatible
Anchor CLI and its IDL build toolchain:

```sh
npm run idl:build
```

Publish the canonical IDL through the Solana program-metadata program:

```sh
npm run idl:publish
```

This runs the requested `npx @solana-program/program-metadata@latest write idl`
command with the configured program address and `./idl.json`, an explicit devnet
RPC, and a temporary keypair derived from `.env`. The signer must hold the program
upgrade authority. It fetches the published IDL, compares it with the local JSON,
and records verification in `deployments/idl-devnet.json`. Temporary key files are
removed after the command finishes.

## Instructions

| Instruction | Authority | Behavior |
| --- | --- | --- |
| `initialize_config` | Upgrade authority | Creates the global config once |
| `set_paused` | Admin | Blocks or enables delegate withdrawals globally |
| `propose_admin`, `accept_admin` | Current / proposed admin | Two-step admin rotation |
| `create_wallet` | Creator | Creates wallet state and funds vault rent |
| `deposit_sol` | Any payer | Deposits a positive SOL amount into the vault |
| `set_frozen` | Owner | Blocks or enables delegates for one wallet |
| `propose_owner`, `accept_owner` | Current / proposed owner | Two-step owner rotation |
| `owner_withdraw_sol`, `owner_withdraw_token` | Owner | Withdraws available funds regardless of pause/freeze |
| `add_delegate` | Owner | Creates an asset-specific permission |
| `update_delegate` | Owner | Changes permission without resetting spent amount or window start |
| `revoke_delegate` | Owner | Closes permission, refunds its rent to the current owner |
| `delegate_withdraw_sol`, `delegate_withdraw_token` | Delegate | Withdraws subject to all permission gates |

Delegate parameters:

- `limit_per_period`: positive `u64`, measured in the asset's base units.
- `period_secs`: `0` for a lifetime cap; otherwise `1..31536000` seconds.
- `expires_at`: `0` for no expiry, otherwise a future Unix timestamp. Spending
  fails at or after this timestamp.
- `allowed_recipient`: all-zero key for any recipient; otherwise the recipient
  address for SOL or the destination token account's **owner** for tokens.

Recurring windows are aligned to the original window start and reset lazily when
spending occurs. Unused allowance does not accumulate. This is a fixed-window
limit: spending near either side of a boundary can use two windows' allowances.
A compromised delegate can continue spending in future windows until expiry,
revocation, freeze, or pause.

SOL withdrawals retain the vault's rent-exempt minimum. Wallets cannot be closed,
so wallet/vault rent remains locked. SPL Token and basic Token-2022 transfers use
`transfer_checked`; Token-2022 transfer hooks are unsupported because extra hook
accounts are not forwarded. Extension-specific behavior is not exhaustively tested.
The platform admin has no instruction for moving users' funds, but the program's
upgrade authority can replace code; retain that distinction when assessing trust.

## Integration tests

```sh
npm run test:integration
```

The Node test runner creates an isolated LiteSVM environment for each test, loads
the compiled program under the upgradeable loader, configures fixture upgrade
authority metadata, and submits signed transactions with signature verification.
Clock changes are deterministic; no wall-clock sleeps or devnet airdrops are used.
Only fixture loader metadata is injected; wallet, config, permissions, mints and
token accounts are created by instructions.

Coverage includes all program instructions: deterministic wallet creation,
third-party deposits, SOL balance changes and rent preservation, permission
limits, fixed-window rollover, exact expiry, recipient restrictions, pause/freeze,
owner access while blocked, updates retaining spend, revocation and rent refunds,
owner/admin rotation, invalid parameters, signer/PDA substitution, failed-transaction
rollback, legacy SPL Token and basic Token-2022 transfers and mint isolation.
This is a regression suite, not an exhaustive audit or fuzz campaign.

`scripts/client.mjs` supplies PDA derivation and instruction encoding helpers.
`tests/token-helpers.mjs` encodes the standard SPL instructions used by fixtures.
No generated IDL is required by the test suite.

## Project layout

```text
programs/smart_wallet/src/
  lib.rs                  instruction entrypoints
  state.rs                account layout, validation, rate-limit unit tests
  instructions/           account constraints and handlers
  constants.rs            seeds, SOL sentinel, maximum period
  errors.rs               custom program errors
  events.rs               emitted wallet/delegate/withdrawal events
scripts/                  client helpers, environment loading, deployment
tests/                   LiteSVM transaction tests and token fixture helpers
Anchor.toml               program identities and Anchor test command
DESIGN.md                 account model and security design
```

References: [Anchor LiteSVM guide](https://www.anchor-lang.com/docs/testing/litesvm),
[LiteSVM source](https://github.com/LiteSVM/litesvm),
[platform tools v1.54](https://github.com/anza-xyz/platform-tools/releases/tag/v1.54).
