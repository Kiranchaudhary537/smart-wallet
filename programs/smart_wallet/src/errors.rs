use anchor_lang::prelude::*;

#[error_code]
pub enum WalletError {
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Insufficient funds in vault (vault must stay rent-exempt)")]
    InsufficientFunds,
    #[msg("Program is paused by the platform; delegate spending is disabled")]
    ProgramPaused,
    #[msg("Wallet is frozen by its owner; delegate spending is disabled")]
    WalletFrozen,
    #[msg("Delegate permission has expired")]
    DelegateExpired,
    #[msg("Delegate spending limit exceeded for the current period")]
    LimitExceeded,
    #[msg("Recipient is not allowed for this delegate")]
    RecipientNotAllowed,
    #[msg("Invalid delegate parameters")]
    InvalidDelegateParams,
    #[msg("Invalid delegate address")]
    InvalidDelegate,
    #[msg("Invalid recipient")]
    InvalidRecipient,
    #[msg("No pending ownership/admin transfer for this signer")]
    NoPendingTransfer,
}
