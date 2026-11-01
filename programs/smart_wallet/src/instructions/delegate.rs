use anchor_lang::prelude::*;

use crate::{
    constants::{DELEGATE_SEED, VAULT_SEED, WALLET_SEED},
    errors::WalletError,
    events::{DelegateRevoked, DelegateSet},
    state::{Delegate, DelegateParams, Wallet},
};

#[derive(Accounts)]
#[instruction(delegate_key: Pubkey, mint: Pubkey)]
pub struct AddDelegate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [WALLET_SEED, wallet.seed_key.as_ref()],
        bump = wallet.bump,
        has_one = owner @ WalletError::Unauthorized
    )]
    pub wallet: Account<'info, Wallet>,

    #[account(
        init,
        payer = owner,
        space = 8 + Delegate::INIT_SPACE,
        seeds = [DELEGATE_SEED, wallet.key().as_ref(), delegate_key.as_ref(), mint.as_ref()],
        bump
    )]
    pub delegate: Account<'info, Delegate>,

    pub system_program: Program<'info, System>,
}

impl AddDelegate<'_> {
    pub fn add(&mut self, delegate_key: Pubkey, mint: Pubkey, params: DelegateParams, bump: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        params.validate(now)?;

        let wallet_key = self.wallet.key();
        let (vault, _) =
            Pubkey::find_program_address(&[VAULT_SEED, wallet_key.as_ref()], &crate::ID);
        require!(
            delegate_key != Pubkey::default()
                && delegate_key != wallet_key
                && delegate_key != vault
                && delegate_key != self.wallet.owner,
            WalletError::InvalidDelegate
        );

        self.delegate.set_inner(Delegate {
            wallet: wallet_key,
            delegate: delegate_key,
            mint,
            allowed_recipient: params.allowed_recipient,
            limit_per_period: params.limit_per_period,
            period_secs: params.period_secs,
            period_start: now,
            spent_in_period: 0,
            expires_at: params.expires_at,
            bump,
        });
        self.wallet.delegate_count =
            self.wallet.delegate_count.checked_add(1).ok_or(WalletError::MathOverflow)?;

        emit!(DelegateSet {
            wallet: wallet_key,
            delegate: delegate_key,
            mint,
            limit_per_period: params.limit_per_period,
            period_secs: params.period_secs,
            expires_at: params.expires_at,
            allowed_recipient: params.allowed_recipient,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct UpdateDelegate<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [WALLET_SEED, wallet.seed_key.as_ref()],
        bump = wallet.bump,
        has_one = owner @ WalletError::Unauthorized
    )]
    pub wallet: Account<'info, Wallet>,

    #[account(
        mut,
        seeds = [DELEGATE_SEED, wallet.key().as_ref(), delegate.delegate.as_ref(), delegate.mint.as_ref()],
        bump = delegate.bump,
        has_one = wallet @ WalletError::Unauthorized
    )]
    pub delegate: Account<'info, Delegate>,
}

impl UpdateDelegate<'_> {
    /// Updates limits in place. Amount already spent in the current window is
    /// kept, so lowering a limit takes effect immediately.
    pub fn update(&mut self, params: DelegateParams) -> Result<()> {
        params.validate(Clock::get()?.unix_timestamp)?;
        self.delegate.apply_params(&params);
        emit!(DelegateSet {
            wallet: self.wallet.key(),
            delegate: self.delegate.delegate,
            mint: self.delegate.mint,
            limit_per_period: params.limit_per_period,
            period_secs: params.period_secs,
            expires_at: params.expires_at,
            allowed_recipient: params.allowed_recipient,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RevokeDelegate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [WALLET_SEED, wallet.seed_key.as_ref()],
        bump = wallet.bump,
        has_one = owner @ WalletError::Unauthorized
    )]
    pub wallet: Account<'info, Wallet>,

    #[account(
        mut,
        close = owner,
        seeds = [DELEGATE_SEED, wallet.key().as_ref(), delegate.delegate.as_ref(), delegate.mint.as_ref()],
        bump = delegate.bump,
        has_one = wallet @ WalletError::Unauthorized
    )]
    pub delegate: Account<'info, Delegate>,
}

impl RevokeDelegate<'_> {
    pub fn revoke(&mut self) -> Result<()> {
        self.wallet.delegate_count = self.wallet.delegate_count.saturating_sub(1);
        emit!(DelegateRevoked {
            wallet: self.wallet.key(),
            delegate: self.delegate.delegate,
            mint: self.delegate.mint,
        });
        Ok(())
    }
}
