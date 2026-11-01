use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use super::transfers::{send_sol, send_token};
use crate::{
    constants::{SOL_MINT, VAULT_SEED, WALLET_SEED},
    errors::WalletError,
    events::Withdrawn,
    state::Wallet,
};

/// Owner withdrawals are never blocked by `paused` or `frozen`: the platform
/// can never trap a user's funds.
#[derive(Accounts)]
pub struct OwnerWithdrawSol<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [WALLET_SEED, wallet.seed_key.as_ref()],
        bump = wallet.bump,
        has_one = owner @ WalletError::Unauthorized
    )]
    pub wallet: Account<'info, Wallet>,

    #[account(mut, seeds = [VAULT_SEED, wallet.key().as_ref()], bump = wallet.vault_bump)]
    pub vault: SystemAccount<'info>,

    /// CHECK: any account may receive lamports; key is checked against vault/wallet.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> OwnerWithdrawSol<'info> {
    pub fn withdraw(&mut self, amount: u64) -> Result<()> {
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
            authority: self.owner.key(),
            mint: SOL_MINT,
            recipient: self.recipient.key(),
            amount,
            by_delegate: false,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct OwnerWithdrawToken<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [WALLET_SEED, wallet.seed_key.as_ref()],
        bump = wallet.bump,
        has_one = owner @ WalletError::Unauthorized
    )]
    pub wallet: Account<'info, Wallet>,

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

impl<'info> OwnerWithdrawToken<'info> {
    pub fn withdraw(&mut self, amount: u64) -> Result<()> {
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
            authority: self.owner.key(),
            mint: self.mint.key(),
            recipient: self.destination.owner,
            amount,
            by_delegate: false,
        });
        Ok(())
    }
}
