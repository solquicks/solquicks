//! Verifiable quarterly mission draw for Moon Rangers.
//!
//! The draw is deliberately split between chain and server. Putting every
//! entry on-chain would cost more than the prizes are worth, so instead:
//!
//!   1. The server builds the entry list for a finished quarter and hashes it.
//!   2. That hash is committed here, **before** any randomness exists.
//!   3. Randomness is requested from the MagicBlock VRF oracle and written
//!      back exactly once.
//!   4. The server publishes the entry list. Anyone can hash it, compare
//!      against this account, read the randomness, and re-run the selection.
//!
//! Neither half can be swapped after the fact: the hash is fixed before the
//! randomness is knowable, and the randomness cannot be overwritten once set.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{vrf, vrf_callback};
use ephemeral_rollups_sdk::vrf::instructions::{
    create_request_randomness_ix, RequestRandomnessParams,
};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;

declare_id!("8BqrCR3hdX6o1P3tnEjX5xuV9FbTJLU2F8aNBNF5XvCp");

/// A mission id such as "2027-Q1". Bounded so it is safe as a PDA seed.
pub const MAX_MISSION_LEN: usize = 16;
/// More winners than this in a single draw is a configuration mistake.
pub const MAX_WINNERS: u8 = 64;

const UNSET: [u8; 32] = [0u8; 32];

#[program]
pub mod moon_draw {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_authority(ctx: Context<SetAuthority>, new_authority: Pubkey) -> Result<()> {
        require!(
            new_authority != Pubkey::default(),
            DrawError::InvalidAuthority
        );
        ctx.accounts.config.authority = new_authority;
        emit!(AuthorityChanged {
            previous: ctx.accounts.authority.key(),
            current: new_authority,
        });
        Ok(())
    }

    /// Lock in the entry list for a mission. `init` means a mission can only
    /// ever be committed once — there is no path to a second snapshot.
    pub fn commit_draw(
        ctx: Context<CommitDraw>,
        mission: String,
        snapshot_hash: [u8; 32],
        total_tickets: u64,
        winner_count: u8,
    ) -> Result<()> {
        require!(!mission.is_empty(), DrawError::InvalidMission);
        require!(mission.len() <= MAX_MISSION_LEN, DrawError::InvalidMission);
        require!(snapshot_hash != UNSET, DrawError::InvalidSnapshot);
        require!(total_tickets > 0, DrawError::NoEntries);
        require!(winner_count > 0, DrawError::InvalidWinnerCount);
        require!(winner_count <= MAX_WINNERS, DrawError::InvalidWinnerCount);

        let draw = &mut ctx.accounts.draw;
        draw.mission = mission.clone();
        draw.snapshot_hash = snapshot_hash;
        draw.total_tickets = total_tickets;
        draw.winner_count = winner_count;
        draw.randomness = UNSET;
        draw.requested = false;
        draw.committed_at = Clock::get()?.unix_timestamp;
        draw.fulfilled_at = 0;
        draw.bump = ctx.bumps.draw;

        emit!(DrawCommitted {
            mission,
            snapshot_hash,
            total_tickets,
            winner_count,
            committed_at: draw.committed_at,
        });
        Ok(())
    }

    /// Ask the oracle for randomness. Callable once; the callback is what
    /// actually decides the winners.
    pub fn request_draw(ctx: Context<RequestDraw>, mission: String) -> Result<()> {
        {
            let draw = &ctx.accounts.draw;
            require!(draw.mission == mission, DrawError::InvalidMission);
            require!(draw.randomness == UNSET, DrawError::AlreadyFulfilled);
            require!(!draw.requested, DrawError::AlreadyRequested);
        }

        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackDraw::DISCRIMINATOR.to_vec(),
            caller_seed: ctx.accounts.draw.snapshot_hash,
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.draw.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

        let draw = &mut ctx.accounts.draw;
        draw.requested = true;
        emit!(DrawRequested {
            mission,
            snapshot_hash: draw.snapshot_hash,
        });
        Ok(())
    }

    /// Written by the VRF program only — `#[vrf_callback]` enforces that.
    /// Write-once: a replayed or duplicated callback cannot change a result
    /// that winners have already been published from.
    pub fn callback_draw(ctx: Context<CallbackDraw>, randomness: [u8; 32]) -> Result<()> {
        let draw = &mut ctx.accounts.draw;
        require!(draw.randomness == UNSET, DrawError::AlreadyFulfilled);
        require!(randomness != UNSET, DrawError::InvalidRandomness);

        draw.randomness = randomness;
        draw.fulfilled_at = Clock::get()?.unix_timestamp;

        emit!(DrawFulfilled {
            mission: draw.mission.clone(),
            snapshot_hash: draw.snapshot_hash,
            randomness,
            fulfilled_at: draw.fulfilled_at,
        });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct DrawConfig {
    pub authority: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Draw {
    #[max_len(MAX_MISSION_LEN)]
    pub mission: String,
    /// sha256 over the canonical entry list published by the server.
    pub snapshot_hash: [u8; 32],
    pub total_tickets: u64,
    pub winner_count: u8,
    /// All zeroes until the oracle answers.
    pub randomness: [u8; 32],
    pub requested: bool,
    pub committed_at: i64,
    pub fulfilled_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = DrawConfig::DISCRIMINATOR.len() + DrawConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, DrawConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetAuthority<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = authority @ DrawError::Unauthorized
    )]
    pub config: Account<'info, DrawConfig>,
}

#[derive(Accounts)]
#[instruction(mission: String)]
pub struct CommitDraw<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = authority @ DrawError::Unauthorized
    )]
    pub config: Account<'info, DrawConfig>,
    #[account(
        init,
        payer = authority,
        space = Draw::DISCRIMINATOR.len() + Draw::INIT_SPACE,
        seeds = [b"draw", mission.as_bytes()],
        bump
    )]
    pub draw: Account<'info, Draw>,
    pub system_program: Program<'info, System>,
}

#[vrf]
#[derive(Accounts)]
#[instruction(mission: String)]
pub struct RequestDraw<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = config.authority == payer.key() @ DrawError::Unauthorized
    )]
    pub config: Account<'info, DrawConfig>,
    #[account(
        mut,
        seeds = [b"draw", mission.as_bytes()],
        bump = draw.bump
    )]
    pub draw: Account<'info, Draw>,
    /// CHECK: validated by the VRF program; it is the oracle's own queue.
    #[account(mut)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackDraw<'info> {
    #[account(mut, seeds = [b"draw", draw.mission.as_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
}

#[event]
pub struct AuthorityChanged {
    pub previous: Pubkey,
    pub current: Pubkey,
}

#[event]
pub struct DrawCommitted {
    pub mission: String,
    pub snapshot_hash: [u8; 32],
    pub total_tickets: u64,
    pub winner_count: u8,
    pub committed_at: i64,
}

#[event]
pub struct DrawRequested {
    pub mission: String,
    pub snapshot_hash: [u8; 32],
}

#[event]
pub struct DrawFulfilled {
    pub mission: String,
    pub snapshot_hash: [u8; 32],
    pub randomness: [u8; 32],
    pub fulfilled_at: i64,
}

#[error_code]
pub enum DrawError {
    #[msg("Caller is not the draw authority")]
    Unauthorized,
    #[msg("Mission id is empty or too long")]
    InvalidMission,
    #[msg("Snapshot hash cannot be all zeroes")]
    InvalidSnapshot,
    #[msg("A draw needs at least one entry")]
    NoEntries,
    #[msg("Winner count must be between 1 and 64")]
    InvalidWinnerCount,
    #[msg("Randomness has already been recorded for this mission")]
    AlreadyFulfilled,
    #[msg("Randomness has already been requested for this mission")]
    AlreadyRequested,
    #[msg("Oracle returned empty randomness")]
    InvalidRandomness,
    #[msg("New authority cannot be the default pubkey")]
    InvalidAuthority,
}
