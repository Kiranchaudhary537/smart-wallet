use anchor_lang::prelude::*;

use crate::{constants::CONFIG_SEED, errors::WalletError, events::PausedChanged, state::Config};

/// One-time setup. Only the program's upgrade authority can call it, which
/// prevents anyone front-running deployment to seize the admin role.
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ WalletError::Unauthorized)]
    pub program: Program<'info, crate::program::SmartWallet>,

    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ WalletError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

impl InitializeConfig<'_> {
    pub fn initialize(&mut self, bump: u8) -> Result<()> {
        self.config.set_inner(Config {
            admin: self.admin.key(),
            pending_admin: Pubkey::default(),
            paused: false,
            bump,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ WalletError::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

impl AdminOnly<'_> {
    pub fn set_paused(&mut self, paused: bool) -> Result<()> {
        self.config.paused = paused;
        emit!(PausedChanged { paused });
        Ok(())
    }

    /// Step 1 of admin rotation. Pass Pubkey::default() to cancel.
    pub fn propose_admin(&mut self, new_admin: Pubkey) -> Result<()> {
        self.config.pending_admin = new_admin;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.pending_admin == new_admin.key() @ WalletError::NoPendingTransfer
    )]
    pub config: Account<'info, Config>,
}

impl AcceptAdmin<'_> {
    pub fn accept(&mut self) -> Result<()> {
        self.config.admin = self.new_admin.key();
        self.config.pending_admin = Pubkey::default();
        Ok(())
    }
}
