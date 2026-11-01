use anchor_lang::prelude::*;

#[event]
pub struct WalletCreated {
    pub wallet: Pubkey,
    pub owner: Pubkey,
    pub vault: Pubkey,
}

#[event]
pub struct Withdrawn {
    pub wallet: Pubkey,
    /// Owner or delegate that authorized the withdrawal.
    pub authority: Pubkey,
    /// SOL_MINT (all zeros) for native SOL.
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub by_delegate: bool,
}

#[event]
pub struct DelegateSet {
    pub wallet: Pubkey,
    pub delegate: Pubkey,
    pub mint: Pubkey,
    pub limit_per_period: u64,
    pub period_secs: i64,
    pub expires_at: i64,
    pub allowed_recipient: Pubkey,
}

#[event]
pub struct DelegateRevoked {
    pub wallet: Pubkey,
    pub delegate: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct WalletFrozenChanged {
    pub wallet: Pubkey,
    pub frozen: bool,
}

#[event]
pub struct OwnershipTransferred {
    pub wallet: Pubkey,
    pub previous_owner: Pubkey,
    pub new_owner: Pubkey,
}

#[event]
pub struct PausedChanged {
    pub paused: bool,
}
