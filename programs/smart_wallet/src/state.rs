use anchor_lang::prelude::*;

use crate::{constants::MAX_PERIOD_SECS, errors::WalletError};

/// Global platform config. PDA: ["config"].
///
/// The platform admin can only pause *delegate* spending. It can never move
/// user funds, and it can never block an owner from withdrawing.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Two-step admin rotation. Pubkey::default() = none pending.
    pub pending_admin: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

/// One smart wallet per user. PDA: ["wallet", seed_key].
///
/// Funds are NOT held here; they live in the vault PDA ["vault", wallet],
/// a data-less system account the program signs for.
#[account]
#[derive(InitSpace)]
pub struct Wallet {
    /// Current owner. Can rotate via propose_owner / accept_owner.
    pub owner: Pubkey,
    pub pending_owner: Pubkey,
    /// Original creator; fixed forever so the PDA address never changes.
    pub seed_key: Pubkey,
    /// Owner kill-switch: when true, all delegate spending is blocked.
    pub frozen: bool,
    pub delegate_count: u32,
    pub bump: u8,
    pub vault_bump: u8,
}

/// A scoped permission for one delegate on one asset.
/// PDA: ["delegate", wallet, delegate, mint]  (mint = SOL_MINT for native SOL)
#[account]
#[derive(InitSpace)]
pub struct Delegate {
    pub wallet: Pubkey,
    pub delegate: Pubkey,
    pub mint: Pubkey,
    /// Pubkey::default() = any recipient. For tokens this is compared with the
    /// destination token account's *owner*.
    pub allowed_recipient: Pubkey,
    /// Max amount (lamports or token base units) per window.
    pub limit_per_period: u64,
    /// Window length. 0 = lifetime cap that never resets.
    pub period_secs: i64,
    pub period_start: i64,
    pub spent_in_period: u64,
    /// Unix timestamp. 0 = never expires.
    pub expires_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct DelegateParams {
    pub limit_per_period: u64,
    pub period_secs: i64,
    pub expires_at: i64,
    pub allowed_recipient: Pubkey,
}

impl DelegateParams {
    pub fn validate(&self, now: i64) -> Result<()> {
        require!(self.limit_per_period > 0, WalletError::InvalidDelegateParams);
        require!(
            (0..=MAX_PERIOD_SECS).contains(&self.period_secs),
            WalletError::InvalidDelegateParams
        );
        require!(
            self.expires_at == 0 || self.expires_at > now,
            WalletError::InvalidDelegateParams
        );
        Ok(())
    }
}

impl Delegate {
    pub fn apply_params(&mut self, p: &DelegateParams) {
        self.limit_per_period = p.limit_per_period;
        self.period_secs = p.period_secs;
        self.expires_at = p.expires_at;
        self.allowed_recipient = p.allowed_recipient;
    }

    pub fn check_recipient(&self, recipient: &Pubkey) -> Result<()> {
        require!(
            self.allowed_recipient == Pubkey::default() || self.allowed_recipient == *recipient,
            WalletError::RecipientNotAllowed
        );
        Ok(())
    }

    /// Checks expiry, rolls the window forward if needed, and records `amount`
    /// as spent. Fails (without mutating) if the limit would be exceeded.
    pub fn consume(&mut self, amount: u64, now: i64) -> Result<()> {
        require!(amount > 0, WalletError::ZeroAmount);
        if self.expires_at != 0 {
            require!(now < self.expires_at, WalletError::DelegateExpired);
        }

        let (mut start, mut spent) = (self.period_start, self.spent_in_period);
        if self.period_secs > 0 {
            let elapsed = now.checked_sub(start).ok_or(WalletError::MathOverflow)?;
            if elapsed >= self.period_secs {
                // Align to the window containing `now` without drifting
                // the original fixed-window schedule.
                let windows = elapsed / self.period_secs;
                start = start
                    .checked_add(windows.checked_mul(self.period_secs).ok_or(WalletError::MathOverflow)?)
                    .ok_or(WalletError::MathOverflow)?;
                spent = 0;
            }
        }

        let new_spent = spent.checked_add(amount).ok_or(WalletError::MathOverflow)?;
        require!(new_spent <= self.limit_per_period, WalletError::LimitExceeded);

        self.period_start = start;
        self.spent_in_period = new_spent;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(limit: u64, period: i64, expires: i64) -> Delegate {
        Delegate {
            wallet: Pubkey::default(),
            delegate: Pubkey::new_unique(),
            mint: Pubkey::default(),
            allowed_recipient: Pubkey::default(),
            limit_per_period: limit,
            period_secs: period,
            period_start: 1_000,
            spent_in_period: 0,
            expires_at: expires,
            bump: 0,
        }
    }

    #[test]
    fn enforces_limit_within_window() {
        let mut x = d(100, 60, 0);
        x.consume(60, 1_010).unwrap();
        x.consume(40, 1_020).unwrap();
        assert!(x.consume(1, 1_030).is_err());
        assert_eq!(x.spent_in_period, 100, "failed call must not mutate");
    }

    #[test]
    fn resets_and_aligns_window() {
        let mut x = d(100, 60, 0);
        x.consume(100, 1_000).unwrap();
        // 3.5 windows later -> new window starts at 1_000 + 3*60
        x.consume(100, 1_210).unwrap();
        assert_eq!(x.period_start, 1_180);
        assert!(x.consume(1, 1_239).is_err());
        x.consume(1, 1_240).unwrap();
    }

    #[test]
    fn lifetime_cap_never_resets() {
        let mut x = d(50, 0, 0);
        x.consume(50, 1_000).unwrap();
        assert!(x.consume(1, 9_999_999).is_err());
    }

    #[test]
    fn expiry_and_zero_amount() {
        let mut x = d(100, 60, 2_000);
        x.consume(1, 1_999).unwrap();
        assert!(x.consume(1, 2_000).is_err());
        assert!(d(100, 60, 0).consume(0, 1_000).is_err());
    }

    #[test]
    fn recipient_allowlist() {
        let mut x = d(100, 60, 0);
        let ok = Pubkey::new_unique();
        assert!(x.check_recipient(&ok).is_ok());
        x.allowed_recipient = ok;
        assert!(x.check_recipient(&ok).is_ok());
        assert!(x.check_recipient(&Pubkey::new_unique()).is_err());
    }

    #[test]
    fn param_validation() {
        let p = |l, per, exp| DelegateParams {
            limit_per_period: l,
            period_secs: per,
            expires_at: exp,
            allowed_recipient: Pubkey::default(),
        };
        assert!(p(1, 60, 0).validate(100).is_ok());
        assert!(p(0, 60, 0).validate(100).is_err());
        assert!(p(1, -1, 0).validate(100).is_err());
        assert!(p(1, MAX_PERIOD_SECS + 1, 0).validate(100).is_err());
        assert!(p(1, 60, 100).validate(100).is_err());
    }
}
