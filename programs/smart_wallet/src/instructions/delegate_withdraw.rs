use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use super::transfers::{send_sol, send_token};
use crate::{
    constants::{CONFIG_SEED, DELEGATE_SEED, SOL_MINT, VAULT_SEED, WALLET_SEED},
    errors::WalletError,
    events::Withdrawn,
    state::{Config, Delegate, Wallet},
};

/// Delegate SOL spend. Gates, in order: platform pause -> owner freeze ->
/// delegate PDA derived from (wallet, signer, SOL) -> recipient allowlist ->
/// expiry + rate limit. All checks run before any funds move.
#[derive(Accounts)]
pub struct DelegateWithdrawSol<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused @ WalletError::ProgramPaused
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [WALLET_SEED, wallet.seed_key.as_ref()],
        bump = wallet.bump,
        constraint = !wallet.frozen @ WalletError::WalletFrozen
    )]
    pub wallet: Account<'info, Wallet>,

    // Seeds bind this permission to *this* signer and to native SOL, so a
    // token allowance or someone else's allowance can never be used here.
    #[account(
        mut,
        seeds = [DELEGATE_SEED, wallet.key().as_ref(), authority.key().as_ref(), SOL_MINT.as_ref()],
        bump = delegate.bump,
        has_one = wallet @ WalletError::Unauthorized
    )]
    pub delegate: Account<'info, Delegate>,

    #[account(mut, seeds = [VAULT_SEED, wallet.key().as_ref()], bump = wallet.vault_bump)]
    pub vault: SystemAccount<'info>,

    /// CHECK: any account may receive lamports; checked against the allowlist.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> DelegateWithdrawSol<'info> {
    pub fn withdraw(&mut self, amount: u64) -> Result<()> {
        self.delegate.check_recipient(&self.recipient.key())?;
        self.delegate.consume(amount, Clock::get()?.unix_timestamp)?;

        send_sol(
            self.wallet.key(),
            self.wallet.vault_bump,
            &self.vault,
            &self.recipient.to_account_info(),
            &self.system_program,
            amount,
        )?;
        emit!(Withdrawn {
            wallet: self.wallet.key(),
            authority: self.authority.key(),
            mint: SOL_MINT,
            recipient: self.recipient.key(),
            amount,
            by_delegate: true,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct DelegateWithdrawToken<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused @ WalletError::ProgramPaused
    )]
    pub config: Account<'info, Config>,

    #[account(
        seeds = [WALLET_SEED, wallet.seed_key.as_ref()],
        bump = wallet.bump,
        constraint = !wallet.frozen @ WalletError::WalletFrozen
    )]
    pub wallet: Account<'info, Wallet>,

    #[account(
        mut,
        seeds = [DELEGATE_SEED, wallet.key().as_ref(), authority.key().as_ref(), mint.key().as_ref()],
        bump = delegate.bump,
        has_one = wallet @ WalletError::Unauthorized
    )]
    pub delegate: Account<'info, Delegate>,

    #[account(seeds = [VAULT_SEED, wallet.key().as_ref()], bump = wallet.vault_bump)]
    pub vault: SystemAccount<'info>,

    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = vault,
        token::token_program = token_program
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> DelegateWithdrawToken<'info> {
    pub fn withdraw(&mut self, amount: u64) -> Result<()> {
        // Allowlist is matched on the destination token account's owner.
        self.delegate.check_recipient(&self.destination.owner)?;
        self.delegate.consume(amount, Clock::get()?.unix_timestamp)?;

        send_token(
            self.wallet.key(),
            self.wallet.vault_bump,
            &self.vault,
            &self.mint,
            &self.vault_token_account,
            &self.destination,
            &self.token_program.to_account_info(),
            amount,
        )?;
        emit!(Withdrawn {
            wallet: self.wallet.key(),
            authority: self.authority.key(),
            mint: self.mint.key(),
            recipient: self.destination.owner,
            amount,
            by_delegate: true,
        });
        Ok(())
    }
}
