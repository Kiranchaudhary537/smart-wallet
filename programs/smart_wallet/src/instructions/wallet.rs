use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{
    constants::{VAULT_SEED, WALLET_SEED},
    errors::WalletError,
    events::{OwnershipTransferred, WalletCreated, WalletFrozenChanged},
    state::Wallet,
};

/// Creates the user's unique wallet + vault and makes the vault rent-exempt.
#[derive(Accounts)]
pub struct CreateWallet<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Wallet::INIT_SPACE,
        seeds = [WALLET_SEED, owner.key().as_ref()],
        bump
    )]
    pub wallet: Account<'info, Wallet>,

    #[account(mut, seeds = [VAULT_SEED, wallet.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> CreateWallet<'info> {
    pub fn create(&mut self, bump: u8, vault_bump: u8) -> Result<()> {
        self.wallet.set_inner(Wallet {
            owner: self.owner.key(),
            pending_owner: Pubkey::default(),
            seed_key: self.owner.key(),
            frozen: false,
            delegate_count: 0,
            bump,
            vault_bump,
        });

        let top_up = Rent::get()?.minimum_balance(0).saturating_sub(self.vault.lamports());
        if top_up > 0 {
            transfer(
                CpiContext::new(
                    self.system_program.key(),
                    Transfer {
                        from: self.owner.to_account_info(),
                        to: self.vault.to_account_info(),
                    },
                ),
                top_up,
            )?;
        }

        emit!(WalletCreated {
            wallet: self.wallet.key(),
            owner: self.owner.key(),
            vault: self.vault.key(),
        });
        Ok(())
    }
}

/// Convenience deposit (anyone can also just send SOL to the vault address,
/// or tokens to the vault's associated token account).
#[derive(Accounts)]
pub struct DepositSol<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [WALLET_SEED, wallet.seed_key.as_ref()], bump = wallet.bump)]
    pub wallet: Account<'info, Wallet>,

    #[account(mut, seeds = [VAULT_SEED, wallet.key().as_ref()], bump = wallet.vault_bump)]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl DepositSol<'_> {
    pub fn deposit(&mut self, amount: u64) -> Result<()> {
        require!(amount > 0, WalletError::ZeroAmount);
        transfer(
            CpiContext::new(
                self.system_program.key(),
                Transfer { from: self.payer.to_account_info(), to: self.vault.to_account_info() },
            ),
            amount,
        )
    }
}

/// Owner-only wallet management (freeze, ownership rotation).
#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [WALLET_SEED, wallet.seed_key.as_ref()],
        bump = wallet.bump,
        has_one = owner @ WalletError::Unauthorized
    )]
    pub wallet: Account<'info, Wallet>,
}

impl OwnerOnly<'_> {
    pub fn set_frozen(&mut self, frozen: bool) -> Result<()> {
        self.wallet.frozen = frozen;
        emit!(WalletFrozenChanged { wallet: self.wallet.key(), frozen });
        Ok(())
    }

    /// Step 1 of key rotation. Pubkey::default() cancels a pending transfer.
    pub fn propose_owner(&mut self, new_owner: Pubkey) -> Result<()> {
        require_keys_neq!(new_owner, self.wallet.key(), WalletError::Unauthorized);
        self.wallet.pending_owner = new_owner;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct AcceptOwner<'info> {
    pub new_owner: Signer<'info>,

    #[account(
        mut,
        seeds = [WALLET_SEED, wallet.seed_key.as_ref()],
        bump = wallet.bump,
        constraint = wallet.pending_owner == new_owner.key() @ WalletError::NoPendingTransfer
    )]
    pub wallet: Account<'info, Wallet>,
}

impl AcceptOwner<'_> {
    pub fn accept(&mut self) -> Result<()> {
        let previous_owner = self.wallet.owner;
        self.wallet.owner = self.new_owner.key();
        self.wallet.pending_owner = Pubkey::default();
        emit!(OwnershipTransferred {
            wallet: self.wallet.key(),
            previous_owner,
            new_owner: self.wallet.owner,
        });
        Ok(())
    }
}
