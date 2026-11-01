use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const WALLET_SEED: &[u8] = b"wallet";
pub const VAULT_SEED: &[u8] = b"vault";
pub const DELEGATE_SEED: &[u8] = b"delegate";

/// Sentinel "mint" used for native SOL allowances (all-zero key).
pub const SOL_MINT: Pubkey = Pubkey::new_from_array([0u8; 32]);

/// Upper bound on a delegate's reset window (1 year).
pub const MAX_PERIOD_SECS: i64 = 365 * 24 * 60 * 60;
