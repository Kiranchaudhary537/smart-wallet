//! Vault-signed transfer helpers. The only places funds leave a vault.
use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked};

use crate::{constants::VAULT_SEED, errors::WalletError};

pub fn send_sol<'info>(
    wallet: Pubkey,
    vault_bump: u8,
    vault: &SystemAccount<'info>,
    recipient: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, WalletError::ZeroAmount);
    require_keys_neq!(recipient.key(), vault.key(), WalletError::InvalidRecipient);
    require_keys_neq!(recipient.key(), wallet, WalletError::InvalidRecipient);

    // Vault must stay rent-exempt so it never gets garbage-collected.
    let rent_min = Rent::get()?.minimum_balance(0);
    let available = vault.lamports().saturating_sub(rent_min);
    require!(amount <= available, WalletError::InsufficientFunds);

    let bump = [vault_bump];
    let seeds: &[&[u8]] = &[VAULT_SEED, wallet.as_ref(), &bump];
    let signer = &[seeds];
    transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            Transfer { from: vault.to_account_info(), to: recipient.clone() },
            signer,
        ),
        amount,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn send_token<'info>(
    wallet: Pubkey,
    vault_bump: u8,
    vault: &SystemAccount<'info>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    token_program: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, WalletError::ZeroAmount);
    require_keys_neq!(from.key(), to.key(), WalletError::InvalidRecipient);
    require!(amount <= from.amount, WalletError::InsufficientFunds);

    let bump = [vault_bump];
    let seeds: &[&[u8]] = &[VAULT_SEED, wallet.as_ref(), &bump];
    let signer = &[seeds];
    transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: vault.to_account_info(),
            },
            signer,
        ),
        amount,
        mint.decimals,
    )
}
