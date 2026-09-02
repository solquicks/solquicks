//! Moon Rangers escrow staking.
//!
//! Design notes, because this program custodies other people's NFTs:
//!
//! * A stake record stores the depositing owner. Withdrawal pays out to the
//!   recorded owner and nobody else, so even a mistaken client cannot redirect
//!   an NFT to a different wallet.
//! * The program can only move an NFT between the owner and its own vault.
//!   There is no instruction that sends an NFT anywhere else, including to the
//!   admin. `emergency_return` exists so a stuck NFT can be pushed home, but it
//!   is still hard-wired to the recorded owner.
//! * Points are deliberately NOT handled here. They live off-chain, which keeps
//!   this program small enough to read end to end.
//! * Only NFTs from the configured collection can be staked, verified against
//!   Metaplex metadata rather than trusting the client.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{close_account, transfer, CloseAccount, Mint, Token, TokenAccount, Transfer},
};

declare_id!("AbiL2mVBQgPbCujUuZFbdWXkHVAycriKjmQw16RiTKLG");

/// Metaplex Token Metadata program.
pub const TOKEN_METADATA_ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

#[program]
pub mod moon_stake {
    use super::*;

    /// One-time setup. `admin` can pause staking and trigger emergency returns,
    /// but can never take custody of an NFT.
    pub fn initialize(
        ctx: Context<Initialize>,
        collection: Pubkey,
        fee_lamports: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.treasury = ctx.accounts.treasury.key();
        config.collection = collection;
        config.fee_lamports = fee_lamports;
        config.paused = false;
        config.total_staked = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    pub fn set_fee(ctx: Context<AdminOnly>, fee_lamports: u64) -> Result<()> {
        ctx.accounts.config.fee_lamports = fee_lamports;
        Ok(())
    }

    /// Rotate where stake fees are paid. Without this the treasury would be
    /// fixed at initialization, so a compromised or lost treasury wallet would
    /// mean redeploying the program.
    pub fn set_treasury(ctx: Context<SetTreasury>) -> Result<()> {
        ctx.accounts.config.treasury = ctx.accounts.new_treasury.key();
        emit!(TreasuryChanged {
            treasury: ctx.accounts.config.treasury,
        });
        Ok(())
    }

    /// Move one Ranger into escrow and record who it came from.
    pub fn stake(ctx: Context<Stake>) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, StakeError::Paused);
        require!(ctx.accounts.owner_token.amount == 1, StakeError::NotHeld);

        verify_collection_member(
            &ctx.accounts.metadata,
            &ctx.accounts.nft_mint.key(),
            &config.collection,
        )?;

        if config.fee_lamports > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.owner.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                ),
                config.fee_lamports,
            )?;
        }

        transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.owner_token.to_account_info(),
                    to: ctx.accounts.vault_token.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            1,
        )?;

        let record = &mut ctx.accounts.stake_record;
        record.owner = ctx.accounts.owner.key();
        record.nft_mint = ctx.accounts.nft_mint.key();
        record.staked_at = Clock::get()?.unix_timestamp;
        record.bump = ctx.bumps.stake_record;

        let config = &mut ctx.accounts.config;
        config.total_staked = config.total_staked.saturating_add(1);

        emit!(Staked {
            owner: record.owner,
            nft_mint: record.nft_mint,
            staked_at: record.staked_at,
        });
        Ok(())
    }

    /// Return the Ranger to the wallet that deposited it.
    /// Deliberately callable while paused — pausing must never trap an NFT.
    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        let staked_at = ctx.accounts.stake_record.staked_at;
        release_nft(
            &ctx.accounts.vault_token,
            &ctx.accounts.owner_token,
            &ctx.accounts.stake_record,
            ctx.accounts.owner.to_account_info(),
            &ctx.accounts.token_program,
        )?;

        let config = &mut ctx.accounts.config;
        config.total_staked = config.total_staked.saturating_sub(1);

        emit!(Unstaked {
            owner: ctx.accounts.owner.key(),
            nft_mint: ctx.accounts.stake_record.nft_mint,
            staked_at,
            unstaked_at: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Admin-triggered return, for when an owner cannot call unstake themselves.
    /// The destination is still the recorded owner — the admin cannot redirect it.
    pub fn emergency_return(ctx: Context<EmergencyReturn>) -> Result<()> {
        release_nft(
            &ctx.accounts.vault_token,
            &ctx.accounts.owner_token,
            &ctx.accounts.stake_record,
            ctx.accounts.owner.to_account_info(),
            &ctx.accounts.token_program,
        )?;

        let config = &mut ctx.accounts.config;
        config.total_staked = config.total_staked.saturating_sub(1);

        emit!(EmergencyReturned {
            owner: ctx.accounts.owner.key(),
            nft_mint: ctx.accounts.stake_record.nft_mint,
        });
        Ok(())
    }
}

/// Shared exit path: vault -> recorded owner, then close the empty vault.
fn release_nft<'info>(
    vault_token: &Account<'info, TokenAccount>,
    owner_token: &Account<'info, TokenAccount>,
    stake_record: &Account<'info, StakeRecord>,
    owner: AccountInfo<'info>,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    require!(vault_token.amount == 1, StakeError::VaultEmpty);

    let mint_key = stake_record.nft_mint;
    let seeds: &[&[u8]] = &[b"stake", mint_key.as_ref(), &[stake_record.bump]];
    let signer: &[&[&[u8]]] = &[seeds];

    transfer(
        CpiContext::new_with_signer(
            token_program.key(),
            Transfer {
                from: vault_token.to_account_info(),
                to: owner_token.to_account_info(),
                authority: stake_record.to_account_info(),
            },
            signer,
        ),
        1,
    )?;

    // reclaim the vault's rent for the owner
    close_account(CpiContext::new_with_signer(
        token_program.key(),
        CloseAccount {
            account: vault_token.to_account_info(),
            destination: owner,
            authority: stake_record.to_account_info(),
        },
        signer,
    ))?;
    Ok(())
}

/// Confirm the mint really belongs to the configured collection, by reading
/// Metaplex metadata rather than believing the caller.
fn verify_collection_member(
    metadata: &UncheckedAccount,
    nft_mint: &Pubkey,
    expected_collection: &Pubkey,
) -> Result<()> {
    let expected_pda = Pubkey::find_program_address(
        &[b"metadata", TOKEN_METADATA_ID.as_ref(), nft_mint.as_ref()],
        &TOKEN_METADATA_ID,
    )
    .0;
    require_keys_eq!(metadata.key(), expected_pda, StakeError::BadMetadata);
    require!(
        metadata.owner == &TOKEN_METADATA_ID,
        StakeError::BadMetadata
    );

    let data = metadata.try_borrow_data()?;
    let collection = read_collection(&data).ok_or(StakeError::NoCollection)?;
    require!(collection.0, StakeError::CollectionUnverified);
    require_keys_eq!(
        collection.1,
        *expected_collection,
        StakeError::WrongCollection
    );
    Ok(())
}

/// Walk the Token Metadata layout to the optional `collection` field.
/// Returns (verified, collection_key).
fn read_collection(data: &[u8]) -> Option<(bool, Pubkey)> {
    let mut o: usize = 1 + 32 + 32; // key + update_authority + mint

    // three borsh strings: name, symbol, uri
    for _ in 0..3 {
        let end = o.checked_add(4)?;
        let len = u32::from_le_bytes(data.get(o..end)?.try_into().ok()?) as usize;
        o = end.checked_add(len)?;
    }
    o = o.checked_add(2)?; // seller_fee_basis_points

    // creators: Option<Vec<Creator>>, each creator is 34 bytes
    match data.get(o)? {
        0 => o = o.checked_add(1)?,
        1 => {
            o = o.checked_add(1)?;
            let end = o.checked_add(4)?;
            let n = u32::from_le_bytes(data.get(o..end)?.try_into().ok()?) as usize;
            o = end.checked_add(n.checked_mul(34)?)?;
        }
        _ => return None,
    }

    o = o.checked_add(2)?; // primary_sale_happened + is_mutable
    o = advance_option(data, o, 1)?; // edition_nonce: Option<u8>
    o = advance_option(data, o, 1)?; // token_standard: Option<u8>

    // collection: Option<Collection { verified: bool, key: Pubkey }>
    match data.get(o)? {
        0 => None,
        1 => {
            let verified = *data.get(o.checked_add(1)?)? == 1;
            let start = o.checked_add(2)?;
            let end = o.checked_add(34)?;
            let key = Pubkey::try_from(data.get(start..end)?).ok()?;
            Some((verified, key))
        }
        _ => None,
    }
}

fn advance_option(data: &[u8], o: usize, size: usize) -> Option<usize> {
    match data.get(o)? {
        0 => o.checked_add(1),
        1 => o.checked_add(1)?.checked_add(size),
        _ => None,
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: destination for stake fees; only ever receives lamports
    pub treasury: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        space = Config::DISCRIMINATOR.len() + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = admin @ StakeError::NotAdmin
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct SetTreasury<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = admin @ StakeError::NotAdmin
    )]
    pub config: Account<'info, Config>,
    /// CHECK: only recorded as a payout destination; never signs, never read
    pub new_treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// CHECK: verified against config.treasury
    #[account(mut, address = config.treasury @ StakeError::WrongTreasury)]
    pub treasury: UncheckedAccount<'info>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = owner_token.mint == nft_mint.key() @ StakeError::MintMismatch,
        constraint = owner_token.owner == owner.key() @ StakeError::NotHeld
    )]
    pub owner_token: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = owner,
        space = StakeRecord::DISCRIMINATOR.len() + StakeRecord::INIT_SPACE,
        seeds = [b"stake", nft_mint.key().as_ref()],
        bump
    )]
    pub stake_record: Account<'info, StakeRecord>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = nft_mint,
        associated_token::authority = stake_record
    )]
    pub vault_token: Account<'info, TokenAccount>,

    /// CHECK: address and ownership are checked in verify_collection_member
    pub metadata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    /// The recorded depositor must sign.
    #[account(mut, address = stake_record.owner @ StakeError::NotOwner)]
    pub owner: Signer<'info>,

    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        close = owner,
        seeds = [b"stake", stake_record.nft_mint.as_ref()],
        bump = stake_record.bump
    )]
    pub stake_record: Account<'info, StakeRecord>,

    #[account(
        mut,
        constraint = vault_token.mint == stake_record.nft_mint @ StakeError::MintMismatch,
        constraint = vault_token.owner == stake_record.key() @ StakeError::BadVault
    )]
    pub vault_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_token.mint == stake_record.nft_mint @ StakeError::MintMismatch,
        constraint = owner_token.owner == stake_record.owner @ StakeError::NotOwner
    )]
    pub owner_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct EmergencyReturn<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = admin @ StakeError::NotAdmin
    )]
    pub config: Account<'info, Config>,

    /// CHECK: must be the recorded depositor; funds and NFT go here
    #[account(mut, address = stake_record.owner @ StakeError::NotOwner)]
    pub owner: UncheckedAccount<'info>,

    #[account(
        mut,
        close = owner,
        seeds = [b"stake", stake_record.nft_mint.as_ref()],
        bump = stake_record.bump
    )]
    pub stake_record: Account<'info, StakeRecord>,

    #[account(
        mut,
        constraint = vault_token.mint == stake_record.nft_mint @ StakeError::MintMismatch,
        constraint = vault_token.owner == stake_record.key() @ StakeError::BadVault
    )]
    pub vault_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_token.mint == stake_record.nft_mint @ StakeError::MintMismatch,
        constraint = owner_token.owner == stake_record.owner @ StakeError::NotOwner
    )]
    pub owner_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub collection: Pubkey,
    pub fee_lamports: u64,
    pub total_staked: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct StakeRecord {
    pub owner: Pubkey,
    pub nft_mint: Pubkey,
    pub staked_at: i64,
    pub bump: u8,
}

#[event]
pub struct Staked {
    pub owner: Pubkey,
    pub nft_mint: Pubkey,
    pub staked_at: i64,
}

#[event]
pub struct Unstaked {
    pub owner: Pubkey,
    pub nft_mint: Pubkey,
    pub staked_at: i64,
    pub unstaked_at: i64,
}

#[event]
pub struct TreasuryChanged {
    pub treasury: Pubkey,
}

#[event]
pub struct EmergencyReturned {
    pub owner: Pubkey,
    pub nft_mint: Pubkey,
}

#[error_code]
pub enum StakeError {
    #[msg("Staking is paused")]
    Paused,
    #[msg("Only the admin can do that")]
    NotAdmin,
    #[msg("Only the wallet that staked this Ranger can unstake it")]
    NotOwner,
    #[msg("That Ranger is not in this wallet")]
    NotHeld,
    #[msg("Token account does not match the Ranger")]
    MintMismatch,
    #[msg("Vault account is not owned by the stake record")]
    BadVault,
    #[msg("Vault does not hold the Ranger")]
    VaultEmpty,
    #[msg("Metadata account is not the one for this mint")]
    BadMetadata,
    #[msg("This NFT has no collection")]
    NoCollection,
    #[msg("This NFT's collection is not verified")]
    CollectionUnverified,
    #[msg("This NFT is not a Moon Ranger")]
    WrongCollection,
    #[msg("Treasury does not match config")]
    WrongTreasury,
}
