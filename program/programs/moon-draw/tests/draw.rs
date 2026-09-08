//! Abuse-path tests for moon-draw.
//!
//! The draw is only trustworthy if two things hold: the entry list is fixed
//! before anyone knows the randomness, and the randomness cannot be rerolled
//! once it lands. Everything below is an attempt to break one of those.

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_address::Address;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

fn pid() -> Address {
    Address::new_from_array(moon_draw::ID.to_bytes())
}
fn to_anchor(a: &Address) -> anchor_lang::prelude::Pubkey {
    anchor_lang::prelude::Pubkey::new_from_array(a.to_bytes())
}
fn from_anchor(p: &anchor_lang::prelude::Pubkey) -> Address {
    Address::new_from_array(p.to_bytes())
}

fn metas(m: Vec<anchor_lang::prelude::AccountMeta>) -> Vec<solana_instruction::AccountMeta> {
    m.into_iter()
        .map(|m| solana_instruction::AccountMeta {
            pubkey: from_anchor(&m.pubkey),
            is_signer: m.is_signer,
            is_writable: m.is_writable,
        })
        .collect()
}

struct World {
    svm: LiteSVM,
    admin: Keypair,
    config: Address,
}

fn setup() -> World {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(pid(), "../../target/deploy/moon_draw.so")
        .expect("run `anchor build` first");

    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
    let (config, _) = Address::find_program_address(&[b"config"], &pid());

    let ix = Instruction {
        program_id: pid(),
        accounts: metas(
            moon_draw::accounts::Initialize {
                authority: to_anchor(&admin.pubkey()),
                config: to_anchor(&config),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        ),
        data: moon_draw::instruction::Initialize {}.data(),
    };
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    let tx = Transaction::new(&[&admin], msg, svm.latest_blockhash());
    svm.send_transaction(tx).expect("initialize");

    World { svm, admin, config }
}

fn draw_pda(mission: &str) -> Address {
    Address::find_program_address(&[b"draw", mission.as_bytes()], &pid()).0
}

fn commit_ix(
    w: &World,
    signer: &Address,
    mission: &str,
    hash: [u8; 32],
    total: u64,
    winners: u8,
) -> Instruction {
    Instruction {
        program_id: pid(),
        accounts: metas(
            moon_draw::accounts::CommitDraw {
                authority: to_anchor(signer),
                config: to_anchor(&w.config),
                draw: to_anchor(&draw_pda(mission)),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        ),
        data: moon_draw::instruction::CommitDraw {
            mission: mission.to_string(),
            snapshot_hash: hash,
            total_tickets: total,
            winner_count: winners,
        }
        .data(),
    }
}

fn send(w: &mut LiteSVM, payer: &Keypair, ix: Instruction) -> Result<(), String> {
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer], msg, w.latest_blockhash());
    w.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?}", e))
}

fn hash_of(byte: u8) -> [u8; 32] {
    [byte; 32]
}

#[test]
fn commits_and_stores_the_snapshot() {
    let mut w = setup();
    let ix = commit_ix(&w, &w.admin.pubkey(), "2027-Q1", hash_of(7), 270, 3);
    let admin = w.admin.insecure_clone();
    send(&mut w.svm, &admin, ix).expect("commit should succeed");

    let raw = w.svm.get_account(&draw_pda("2027-Q1")).unwrap();
    let draw = moon_draw::Draw::try_deserialize(&mut raw.data.as_slice()).unwrap();
    assert_eq!(draw.mission, "2027-Q1");
    assert_eq!(draw.snapshot_hash, hash_of(7));
    assert_eq!(draw.total_tickets, 270);
    assert_eq!(draw.winner_count, 3);
    assert_eq!(draw.randomness, [0u8; 32], "randomness must start unset");
    assert!(!draw.requested);
}

#[test]
fn a_stranger_cannot_commit_a_draw() {
    let mut w = setup();
    let mallory = Keypair::new();
    w.svm.airdrop(&mallory.pubkey(), 10_000_000_000).unwrap();

    let ix = commit_ix(&w, &mallory.pubkey(), "2027-Q1", hash_of(7), 270, 3);
    let err = send(&mut w.svm, &mallory, ix).unwrap_err();
    assert!(
        err.contains("Unauthorized") || err.contains("2000"),
        "got: {}",
        err
    );
}

/// The whole point of committing first: a mission's entry list is written once
/// and cannot be replaced with a friendlier one later.
#[test]
fn a_mission_cannot_be_recommitted() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let ix = commit_ix(&w, &admin.pubkey(), "2027-Q1", hash_of(7), 270, 3);
    send(&mut w.svm, &admin, ix).expect("first commit");

    let ix = commit_ix(&w, &admin.pubkey(), "2027-Q1", hash_of(9), 999, 1);
    let err = send(&mut w.svm, &admin, ix).unwrap_err();
    assert!(
        err.contains("already in use") || err.contains("0x0"),
        "got: {}",
        err
    );

    // and the original survived untouched
    let raw = w.svm.get_account(&draw_pda("2027-Q1")).unwrap();
    let draw = moon_draw::Draw::try_deserialize(&mut raw.data.as_slice()).unwrap();
    assert_eq!(draw.snapshot_hash, hash_of(7));
    assert_eq!(draw.total_tickets, 270);
}

#[test]
fn rejects_a_blank_snapshot_hash() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let ix = commit_ix(&w, &admin.pubkey(), "2027-Q1", [0u8; 32], 270, 3);
    let err = send(&mut w.svm, &admin, ix).unwrap_err();
    assert!(
        err.contains("InvalidSnapshot") || err.contains("2002"),
        "got: {}",
        err
    );
}

#[test]
fn rejects_a_draw_with_no_entries() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let ix = commit_ix(&w, &admin.pubkey(), "2027-Q1", hash_of(7), 0, 3);
    let err = send(&mut w.svm, &admin, ix).unwrap_err();
    assert!(
        err.contains("NoEntries") || err.contains("2003"),
        "got: {}",
        err
    );
}

#[test]
fn rejects_absurd_winner_counts() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();

    let ix = commit_ix(&w, &admin.pubkey(), "2027-Q1", hash_of(7), 270, 0);
    assert!(send(&mut w.svm, &admin, ix).is_err(), "zero winners");

    let ix = commit_ix(&w, &admin.pubkey(), "2027-Q2", hash_of(7), 270, 65);
    assert!(
        send(&mut w.svm, &admin, ix).is_err(),
        "more than MAX_WINNERS"
    );
}

#[test]
fn rejects_an_oversized_mission_id() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let long = "2027-Q1-and-then-some-more";
    let ix = commit_ix(&w, &admin.pubkey(), long, hash_of(7), 270, 3);
    assert!(send(&mut w.svm, &admin, ix).is_err());
}

/// Anyone can hand the program a `callback_draw`. Only the VRF program can
/// produce the scoped identity signature it demands, so everyone else bounces.
#[test]
fn a_forged_callback_cannot_set_the_randomness() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let ix = commit_ix(&w, &admin.pubkey(), "2027-Q1", hash_of(7), 270, 3);
    send(&mut w.svm, &admin, ix).expect("commit");

    let mallory = Keypair::new();
    w.svm.airdrop(&mallory.pubkey(), 10_000_000_000).unwrap();

    let ix = Instruction {
        program_id: pid(),
        accounts: metas(
            moon_draw::accounts::CallbackDraw {
                draw: to_anchor(&draw_pda("2027-Q1")),
                vrf_program_identity: to_anchor(&mallory.pubkey()),
            }
            .to_account_metas(None),
        ),
        data: moon_draw::instruction::CallbackDraw {
            randomness: [42u8; 32],
        }
        .data(),
    };
    let err = send(&mut w.svm, &mallory, ix).unwrap_err();
    assert!(!err.is_empty(), "a forged callback must fail");

    let raw = w.svm.get_account(&draw_pda("2027-Q1")).unwrap();
    let draw = moon_draw::Draw::try_deserialize(&mut raw.data.as_slice()).unwrap();
    assert_eq!(draw.randomness, [0u8; 32], "randomness must still be unset");
}

#[test]
fn authority_can_be_rotated_and_the_old_one_loses_access() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let successor = Keypair::new();
    w.svm.airdrop(&successor.pubkey(), 10_000_000_000).unwrap();

    let ix = Instruction {
        program_id: pid(),
        accounts: metas(
            moon_draw::accounts::SetAuthority {
                authority: to_anchor(&admin.pubkey()),
                config: to_anchor(&w.config),
            }
            .to_account_metas(None),
        ),
        data: moon_draw::instruction::SetAuthority {
            new_authority: to_anchor(&successor.pubkey()),
        }
        .data(),
    };
    send(&mut w.svm, &admin, ix).expect("rotate");

    let ix = commit_ix(&w, &admin.pubkey(), "2027-Q1", hash_of(7), 270, 3);
    assert!(
        send(&mut w.svm, &admin, ix).is_err(),
        "old authority must be locked out"
    );

    let ix = commit_ix(&w, &successor.pubkey(), "2027-Q1", hash_of(7), 270, 3);
    send(&mut w.svm, &successor, ix).expect("new authority commits");
}
