//! Smart wallet: every user gets a unique PDA wallet + vault. The owner has
//! full control; delegates ("selected addresses") get scoped, rate-limited,
//! expiring, optionally recipient-locked spending rights per asset.
//! See DESIGN.md for the account model and threat model.
use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::DelegateParams;

declare_id!("64sQLCxxfgLkTwGGvC8jNq1z4P5H29tTY79EizvpzurH");

#[program]
pub mod smart_wallet {
    use super::*;

    // ---------- platform admin ----------
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        ctx.accounts.initialize(ctx.bumps.config)
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.set_paused(paused)
    }

    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.propose_admin(new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        ctx.accounts.accept()
    }

    // ---------- wallet lifecycle ----------
    pub fn create_wallet(ctx: Context<CreateWallet>) -> Result<()> {
        ctx.accounts.create(ctx.bumps.wallet, ctx.bumps.vault)
    }

    pub fn deposit_sol(ctx: Context<DepositSol>, amount: u64) -> Result<()> {
        ctx.accounts.deposit(amount)
    }

    pub fn set_frozen(ctx: Context<OwnerOnly>, frozen: bool) -> Result<()> {
        ctx.accounts.set_frozen(frozen)
    }

    pub fn propose_owner(ctx: Context<OwnerOnly>, new_owner: Pubkey) -> Result<()> {
        ctx.accounts.propose_owner(new_owner)
    }

    pub fn accept_owner(ctx: Context<AcceptOwner>) -> Result<()> {
        ctx.accounts.accept()
    }

    // ---------- owner access ----------
    pub fn owner_withdraw_sol(ctx: Context<OwnerWithdrawSol>, amount: u64) -> Result<()> {
        ctx.accounts.withdraw(amount)
    }

    pub fn owner_withdraw_token(ctx: Context<OwnerWithdrawToken>, amount: u64) -> Result<()> {
        ctx.accounts.withdraw(amount)
    }

    // ---------- delegate management ----------
    pub fn add_delegate(
        ctx: Context<AddDelegate>,
        delegate_key: Pubkey,
        mint: Pubkey,
        params: DelegateParams,
    ) -> Result<()> {
        ctx.accounts.add(delegate_key, mint, params, ctx.bumps.delegate)
    }

    pub fn update_delegate(ctx: Context<UpdateDelegate>, params: DelegateParams) -> Result<()> {
        ctx.accounts.update(params)
    }

    pub fn revoke_delegate(ctx: Context<RevokeDelegate>) -> Result<()> {
        ctx.accounts.revoke()
    }

    // ---------- delegate access ----------
    pub fn delegate_withdraw_sol(ctx: Context<DelegateWithdrawSol>, amount: u64) -> Result<()> {
        ctx.accounts.withdraw(amount)
    }

    pub fn delegate_withdraw_token(ctx: Context<DelegateWithdrawToken>, amount: u64) -> Result<()> {
        ctx.accounts.withdraw(amount)
    }
}
