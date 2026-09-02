//! Abuse-path tests for moon-stake.
//!
//! The happy path is the least interesting thing here. These mostly try to
//! break the program: steal someone else's Ranger, stake a counterfeit, trap
//! an NFT with the pause switch, or get the admin to hand one over.

use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_address::Address;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use spl_token::solana_program::program_pack::Pack;

const TOKEN_METADATA_ID: Address =
    Address::from_str_const("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const TOKEN_PROGRAM_ID: Address =
    Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID: Address =
    Address::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

fn pid() -> Address {
    Address::new_from_array(moon_stake::ID.to_bytes())
}
fn to_anchor(a: &Address) -> anchor_lang::prelude::Pubkey {
    anchor_lang::prelude::Pubkey::new_from_array(a.to_bytes())
}
fn from_anchor(p: &anchor_lang::prelude::Pubkey) -> Address {
    Address::new_from_array(p.to_bytes())
}

struct World {
    svm: LiteSVM,
    admin: Keypair,
    treasury: Address,
    config: Address,
    collection: Address,
}

fn setup(fee_lamports: u64) -> World {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(pid(), "../../target/deploy/moon_stake.so")
        .expect("run `anchor build` first");

    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
    let treasury = Keypair::new().pubkey();
    let collection = Keypair::new().pubkey();
    let (config, _) = Address::find_program_address(&[b"config"], &pid());

    let ix = Instruction {
        program_id: pid(),
        accounts: moon_stake::accounts::Initialize {
            admin: to_anchor(&admin.pubkey()),
            treasury: to_anchor(&treasury),
            config: to_anchor(&config),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None)
        .into_iter()
        .map(|m| solana_instruction::AccountMeta {
            pubkey: from_anchor(&m.pubkey),
            is_signer: m.is_signer,
            is_writable: m.is_writable,
        })
        .collect(),
        data: moon_stake::instruction::Initialize {
            collection: to_anchor(&collection),
            fee_lamports,
        }
        .data(),
    };
    send(&mut svm, &[ix], &admin, &[]).expect("initialize should succeed");

    World {
        svm,
        admin,
        treasury,
        config,
        collection,
    }
}

fn send(
    svm: &mut LiteSVM,
    ixs: &[Instruction],
    payer: &Keypair,
    extra: &[&Keypair],
) -> Result<(), String> {
    let msg = Message::new(ixs, Some(&payer.pubkey()));
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let mut tx = Transaction::new_unsigned(msg);
    tx.sign(&signers, svm.latest_blockhash());
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?}", e.err))
}

/// Build a Metaplex metadata account body the way a real one looks:
/// padded name/symbol/uri, no creators, optional collection.
fn metadata_bytes(mint: &Address, collection: Option<(bool, Address)>) -> Vec<u8> {
    let mut d = Vec::new();
    d.push(4u8); // key: MetadataV1
    d.extend_from_slice(&[0u8; 32]); // update authority
    d.extend_from_slice(&mint.to_bytes());
    for (len, text) in [
        (32usize, "RANGER #1"),
        (10, "MNRNG"),
        (200, "https://x/1.json"),
    ] {
        let mut buf = vec![0u8; len];
        buf[..text.len()].copy_from_slice(text.as_bytes());
        d.extend_from_slice(&(len as u32).to_le_bytes());
        d.extend_from_slice(&buf);
    }
    d.extend_from_slice(&500u16.to_le_bytes()); // seller fee
    d.push(0); // creators: None
    d.push(1); // primary_sale_happened
    d.push(1); // is_mutable
    d.push(0); // edition_nonce: None
    d.push(0); // token_standard: None
    match collection {
        None => d.push(0),
        Some((verified, key)) => {
            d.push(1);
            d.push(verified as u8);
            d.extend_from_slice(&key.to_bytes());
        }
    }
    d
}

/// Mint an NFT straight into an owner's token account, plus its metadata.
fn mint_ranger(
    svm: &mut LiteSVM,
    owner: &Address,
    collection: Option<(bool, Address)>,
) -> (Address, Address, Address) {
    let mint = Keypair::new().pubkey();

    let mut mint_data = vec![0u8; spl_token::state::Mint::LEN];
    spl_token::state::Mint {
        mint_authority: None.into(),
        supply: 1,
        decimals: 0,
        is_initialized: true,
        freeze_authority: None.into(),
    }
    .pack_into_slice(&mut mint_data);
    svm.set_account(
        mint,
        solana_account::Account {
            lamports: 1_000_000,
            data: mint_data,
            owner: TOKEN_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let owner_token = ata(owner, &mint);
    let mut acct = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint: spl_pubkey(&mint),
        owner: spl_pubkey(owner),
        amount: 1,
        delegate: None.into(),
        state: spl_token::state::AccountState::Initialized,
        is_native: None.into(),
        delegated_amount: 0,
        close_authority: None.into(),
    }
    .pack_into_slice(&mut acct);
    svm.set_account(
        owner_token,
        solana_account::Account {
            lamports: 2_039_280,
            data: acct,
            owner: TOKEN_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let (metadata, _) = Address::find_program_address(
        &[b"metadata", TOKEN_METADATA_ID.as_ref(), mint.as_ref()],
        &TOKEN_METADATA_ID,
    );
    svm.set_account(
        metadata,
        solana_account::Account {
            lamports: 5_616_720,
            data: metadata_bytes(&mint, collection),
            owner: TOKEN_METADATA_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    (mint, owner_token, metadata)
}

fn spl_pubkey(a: &Address) -> spl_token::solana_program::pubkey::Pubkey {
    spl_token::solana_program::pubkey::Pubkey::new_from_array(a.to_bytes())
}

fn ata(owner: &Address, mint: &Address) -> Address {
    Address::find_program_address(
        &[owner.as_ref(), TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()],
        &ATA_PROGRAM_ID,
    )
    .0
}

fn stake_record(mint: &Address) -> Address {
    Address::find_program_address(&[b"stake", mint.as_ref()], &pid()).0
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

fn stake_ix(
    w: &World,
    owner: &Address,
    mint: &Address,
    owner_token: &Address,
    metadata: &Address,
) -> Instruction {
    let record = stake_record(mint);
    Instruction {
        program_id: pid(),
        accounts: metas(
            moon_stake::accounts::Stake {
                owner: to_anchor(owner),
                config: to_anchor(&w.config),
                treasury: to_anchor(&w.treasury),
                nft_mint: to_anchor(mint),
                owner_token: to_anchor(owner_token),
                stake_record: to_anchor(&record),
                vault_token: to_anchor(&ata(&record, mint)),
                metadata: to_anchor(metadata),
                token_program: to_anchor(&TOKEN_PROGRAM_ID),
                associated_token_program: to_anchor(&ATA_PROGRAM_ID),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        ),
        data: moon_stake::instruction::Stake {}.data(),
    }
}

fn unstake_ix(w: &World, owner: &Address, mint: &Address, owner_token: &Address) -> Instruction {
    let record = stake_record(mint);
    Instruction {
        program_id: pid(),
        accounts: metas(
            moon_stake::accounts::Unstake {
                owner: to_anchor(owner),
                config: to_anchor(&w.config),
                stake_record: to_anchor(&record),
                vault_token: to_anchor(&ata(&record, mint)),
                owner_token: to_anchor(owner_token),
                token_program: to_anchor(&TOKEN_PROGRAM_ID),
            }
            .to_account_metas(None),
        ),
        data: moon_stake::instruction::Unstake {}.data(),
    }
}

fn token_amount(svm: &LiteSVM, addr: &Address) -> u64 {
    svm.get_account(addr)
        .map(|a| spl_token::state::Account::unpack(&a.data).unwrap().amount)
        .unwrap_or(0)
}

// ─────────────────────────── tests ───────────────────────────

#[test]
fn stake_and_unstake_round_trip() {
    let mut w = setup(0);
    let owner = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (mint, owner_token, metadata) =
        mint_ranger(&mut w.svm, &owner.pubkey(), Some((true, w.collection)));

    let ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    send(&mut w.svm, &[ix], &owner, &[]).expect("staking a real Ranger should work");

    let vault = ata(&stake_record(&mint), &mint);
    assert_eq!(
        token_amount(&w.svm, &vault),
        1,
        "vault should hold the Ranger"
    );
    assert_eq!(
        token_amount(&w.svm, &owner_token),
        0,
        "owner should no longer hold it"
    );

    let ix = unstake_ix(&w, &owner.pubkey(), &mint, &owner_token);
    send(&mut w.svm, &[ix], &owner, &[]).expect("owner should be able to unstake");
    assert_eq!(
        token_amount(&w.svm, &owner_token),
        1,
        "Ranger should be back"
    );
    assert!(
        w.svm
            .get_account(&stake_record(&mint))
            .map(|a| a.data.is_empty())
            .unwrap_or(true),
        "stake record should be closed"
    );
}

#[test]
fn a_stranger_cannot_unstake_your_ranger() {
    let mut w = setup(0);
    let owner = Keypair::new();
    let thief = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    w.svm.airdrop(&thief.pubkey(), 10_000_000_000).unwrap();
    let (mint, owner_token, metadata) =
        mint_ranger(&mut w.svm, &owner.pubkey(), Some((true, w.collection)));

    let ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    send(&mut w.svm, &[ix], &owner, &[]).unwrap();

    // thief signs, but names the real owner's record and token account
    let record = stake_record(&mint);
    let ix = Instruction {
        program_id: pid(),
        accounts: metas(
            moon_stake::accounts::Unstake {
                owner: to_anchor(&thief.pubkey()),
                config: to_anchor(&w.config),
                stake_record: to_anchor(&record),
                vault_token: to_anchor(&ata(&record, &mint)),
                owner_token: to_anchor(&owner_token),
                token_program: to_anchor(&TOKEN_PROGRAM_ID),
            }
            .to_account_metas(None),
        ),
        data: moon_stake::instruction::Unstake {}.data(),
    };
    let err = send(&mut w.svm, &[ix], &thief, &[]).unwrap_err();
    // 6002 == StakeError::NotOwner (anchor errors start at 6000)
    assert!(
        err.contains("6002"),
        "thief should be rejected as NotOwner, got: {err}"
    );
    assert_eq!(
        token_amount(&w.svm, &ata(&record, &mint)),
        1,
        "Ranger must stay in the vault"
    );
}

#[test]
fn a_thief_cannot_redirect_the_payout_to_themselves() {
    let mut w = setup(0);
    let owner = Keypair::new();
    let thief = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    w.svm.airdrop(&thief.pubkey(), 10_000_000_000).unwrap();
    let (mint, owner_token, metadata) =
        mint_ranger(&mut w.svm, &owner.pubkey(), Some((true, w.collection)));
    let __ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    send(&mut w.svm, &[__ix], &owner, &[]).unwrap();

    // give the thief a token account for the same mint and aim the payout at it
    let thief_token = ata(&thief.pubkey(), &mint);
    let mut acct = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint: spl_pubkey(&mint),
        owner: spl_pubkey(&thief.pubkey()),
        amount: 0,
        delegate: None.into(),
        state: spl_token::state::AccountState::Initialized,
        is_native: None.into(),
        delegated_amount: 0,
        close_authority: None.into(),
    }
    .pack_into_slice(&mut acct);
    w.svm
        .set_account(
            thief_token,
            solana_account::Account {
                lamports: 2_039_280,
                data: acct,
                owner: TOKEN_PROGRAM_ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let ix = unstake_ix(&w, &owner.pubkey(), &mint, &thief_token);
    let err = send(&mut w.svm, &[ix], &owner, &[]).unwrap_err();
    assert!(
        !err.is_empty(),
        "payout to a non-owner token account must fail"
    );
    assert_eq!(
        token_amount(&w.svm, &thief_token),
        0,
        "thief must receive nothing"
    );
}

#[test]
fn counterfeit_nft_is_rejected() {
    let mut w = setup(0);
    let owner = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let other_collection = Keypair::new().pubkey();
    let (mint, owner_token, metadata) =
        mint_ranger(&mut w.svm, &owner.pubkey(), Some((true, other_collection)));

    let ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    let err = send(&mut w.svm, &[ix], &owner, &[]).unwrap_err();
    assert!(
        !err.is_empty(),
        "an NFT from another collection must not stake"
    );
}

#[test]
fn unverified_collection_is_rejected() {
    let mut w = setup(0);
    let owner = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    // right collection, but the verified flag is false — anyone can claim this
    let (mint, owner_token, metadata) =
        mint_ranger(&mut w.svm, &owner.pubkey(), Some((false, w.collection)));

    let ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    let err = send(&mut w.svm, &[ix], &owner, &[]).unwrap_err();
    assert!(
        !err.is_empty(),
        "an unverified collection claim must not stake"
    );
}

#[test]
fn nft_without_a_collection_is_rejected() {
    let mut w = setup(0);
    let owner = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (mint, owner_token, metadata) = mint_ranger(&mut w.svm, &owner.pubkey(), None);

    let ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    let err = send(&mut w.svm, &[ix], &owner, &[]).unwrap_err();
    assert!(!err.is_empty(), "an NFT with no collection must not stake");
}

#[test]
fn forged_metadata_account_is_rejected() {
    let mut w = setup(0);
    let owner = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (mint, owner_token, _) = mint_ranger(&mut w.svm, &owner.pubkey(), None);

    // a made-up account that *says* it is a verified Ranger, at the wrong address
    let fake = Keypair::new().pubkey();
    w.svm
        .set_account(
            fake,
            solana_account::Account {
                lamports: 5_616_720,
                data: metadata_bytes(&mint, Some((true, w.collection))),
                owner: TOKEN_METADATA_ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &fake);
    let err = send(&mut w.svm, &[ix], &owner, &[]).unwrap_err();
    assert!(
        !err.is_empty(),
        "metadata at the wrong PDA must be rejected"
    );
}

#[test]
fn the_same_ranger_cannot_be_staked_twice() {
    let mut w = setup(0);
    let owner = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (mint, owner_token, metadata) =
        mint_ranger(&mut w.svm, &owner.pubkey(), Some((true, w.collection)));

    let __ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    send(&mut w.svm, &[__ix], &owner, &[]).unwrap();
    w.svm.expire_blockhash();
    let __ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    let err = send(&mut w.svm, &[__ix], &owner, &[]).unwrap_err();
    assert!(!err.is_empty(), "double staking must fail");
}

#[test]
fn pausing_stops_new_stakes_but_never_traps_an_nft() {
    let mut w = setup(0);
    let owner = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (mint, owner_token, metadata) =
        mint_ranger(&mut w.svm, &owner.pubkey(), Some((true, w.collection)));
    let __ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    send(&mut w.svm, &[__ix], &owner, &[]).unwrap();

    let pause = Instruction {
        program_id: pid(),
        accounts: metas(
            moon_stake::accounts::AdminOnly {
                admin: to_anchor(&w.admin.pubkey()),
                config: to_anchor(&w.config),
            }
            .to_account_metas(None),
        ),
        data: moon_stake::instruction::SetPaused { paused: true }.data(),
    };
    let admin = w.admin.insecure_clone();
    send(&mut w.svm, &[pause], &admin, &[]).expect("admin should be able to pause");

    // new stake blocked
    let (m2, t2, md2) = mint_ranger(&mut w.svm, &owner.pubkey(), Some((true, w.collection)));
    w.svm.expire_blockhash();
    let __ix = stake_ix(&w, &owner.pubkey(), &m2, &t2, &md2);
    let err = send(&mut w.svm, &[__ix], &owner, &[]).unwrap_err();
    assert!(!err.is_empty(), "staking must be blocked while paused");

    // but the already-staked one can still come home
    w.svm.expire_blockhash();
    let __ix = unstake_ix(&w, &owner.pubkey(), &mint, &owner_token);
    send(&mut w.svm, &[__ix], &owner, &[])
        .expect("unstaking must work while paused — a pause must never trap an NFT");
    assert_eq!(token_amount(&w.svm, &owner_token), 1);
}

#[test]
fn admin_cannot_steal_via_emergency_return() {
    let mut w = setup(0);
    let owner = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (mint, owner_token, metadata) =
        mint_ranger(&mut w.svm, &owner.pubkey(), Some((true, w.collection)));
    let __ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    send(&mut w.svm, &[__ix], &owner, &[]).unwrap();

    let record = stake_record(&mint);
    let admin_token = ata(&w.admin.pubkey(), &mint);
    let mut acct = vec![0u8; spl_token::state::Account::LEN];
    spl_token::state::Account {
        mint: spl_pubkey(&mint),
        owner: spl_pubkey(&w.admin.pubkey()),
        amount: 0,
        delegate: None.into(),
        state: spl_token::state::AccountState::Initialized,
        is_native: None.into(),
        delegated_amount: 0,
        close_authority: None.into(),
    }
    .pack_into_slice(&mut acct);
    w.svm
        .set_account(
            admin_token,
            solana_account::Account {
                lamports: 2_039_280,
                data: acct,
                owner: TOKEN_PROGRAM_ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // admin tries to name themselves as the destination
    let ix = Instruction {
        program_id: pid(),
        accounts: metas(
            moon_stake::accounts::EmergencyReturn {
                admin: to_anchor(&w.admin.pubkey()),
                config: to_anchor(&w.config),
                owner: to_anchor(&w.admin.pubkey()),
                stake_record: to_anchor(&record),
                vault_token: to_anchor(&ata(&record, &mint)),
                owner_token: to_anchor(&admin_token),
                token_program: to_anchor(&TOKEN_PROGRAM_ID),
            }
            .to_account_metas(None),
        ),
        data: moon_stake::instruction::EmergencyReturn {}.data(),
    };
    let admin = w.admin.insecure_clone();
    let err = send(&mut w.svm, &[ix], &admin, &[]).unwrap_err();
    assert!(
        !err.is_empty(),
        "admin must not be able to redirect an NFT to themselves"
    );
    assert_eq!(
        token_amount(&w.svm, &admin_token),
        0,
        "admin must receive nothing"
    );
    assert_eq!(
        token_amount(&w.svm, &ata(&record, &mint)),
        1,
        "Ranger stays in the vault"
    );
}

#[test]
fn emergency_return_sends_the_ranger_home() {
    let mut w = setup(0);
    let owner = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (mint, owner_token, metadata) =
        mint_ranger(&mut w.svm, &owner.pubkey(), Some((true, w.collection)));
    let __ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    send(&mut w.svm, &[__ix], &owner, &[]).unwrap();

    let record = stake_record(&mint);
    let ix = Instruction {
        program_id: pid(),
        accounts: metas(
            moon_stake::accounts::EmergencyReturn {
                admin: to_anchor(&w.admin.pubkey()),
                config: to_anchor(&w.config),
                owner: to_anchor(&owner.pubkey()),
                stake_record: to_anchor(&record),
                vault_token: to_anchor(&ata(&record, &mint)),
                owner_token: to_anchor(&owner_token),
                token_program: to_anchor(&TOKEN_PROGRAM_ID),
            }
            .to_account_metas(None),
        ),
        data: moon_stake::instruction::EmergencyReturn {}.data(),
    };
    let admin = w.admin.insecure_clone();
    send(&mut w.svm, &[ix], &admin, &[]).expect("admin should be able to rescue a stuck Ranger");
    assert_eq!(
        token_amount(&w.svm, &owner_token),
        1,
        "Ranger goes back to its owner"
    );
}

#[test]
fn non_admin_cannot_call_emergency_return() {
    let mut w = setup(0);
    let owner = Keypair::new();
    let rando = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    w.svm.airdrop(&rando.pubkey(), 10_000_000_000).unwrap();
    let (mint, owner_token, metadata) =
        mint_ranger(&mut w.svm, &owner.pubkey(), Some((true, w.collection)));
    let __ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    send(&mut w.svm, &[__ix], &owner, &[]).unwrap();

    let record = stake_record(&mint);
    let ix = Instruction {
        program_id: pid(),
        accounts: metas(
            moon_stake::accounts::EmergencyReturn {
                admin: to_anchor(&rando.pubkey()),
                config: to_anchor(&w.config),
                owner: to_anchor(&owner.pubkey()),
                stake_record: to_anchor(&record),
                vault_token: to_anchor(&ata(&record, &mint)),
                owner_token: to_anchor(&owner_token),
                token_program: to_anchor(&TOKEN_PROGRAM_ID),
            }
            .to_account_metas(None),
        ),
        data: moon_stake::instruction::EmergencyReturn {}.data(),
    };
    let err = send(&mut w.svm, &[ix], &rando, &[]).unwrap_err();
    assert!(
        !err.is_empty(),
        "a stranger must not be able to trigger emergency return"
    );
}

#[test]
fn the_stake_fee_reaches_the_treasury() {
    const FEE: u64 = 10_000_000; // 0.01 SOL
    let mut w = setup(FEE);
    let owner = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (mint, owner_token, metadata) =
        mint_ranger(&mut w.svm, &owner.pubkey(), Some((true, w.collection)));

    let before = w
        .svm
        .get_account(&w.treasury)
        .map(|a| a.lamports)
        .unwrap_or(0);
    let __ix = stake_ix(&w, &owner.pubkey(), &mint, &owner_token, &metadata);
    send(&mut w.svm, &[__ix], &owner, &[]).expect("staking with a fee should work");
    let after = w
        .svm
        .get_account(&w.treasury)
        .map(|a| a.lamports)
        .unwrap_or(0);
    assert_eq!(
        after - before,
        FEE,
        "treasury should receive exactly the fee"
    );
}

#[test]
fn fee_cannot_be_diverted_to_another_wallet() {
    let mut w = setup(10_000_000);
    let owner = Keypair::new();
    w.svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    let (mint, owner_token, metadata) =
        mint_ranger(&mut w.svm, &owner.pubkey(), Some((true, w.collection)));

    let attacker_treasury = Keypair::new().pubkey();
    let record = stake_record(&mint);
    let ix = Instruction {
        program_id: pid(),
        accounts: metas(
            moon_stake::accounts::Stake {
                owner: to_anchor(&owner.pubkey()),
                config: to_anchor(&w.config),
                treasury: to_anchor(&attacker_treasury),
                nft_mint: to_anchor(&mint),
                owner_token: to_anchor(&owner_token),
                stake_record: to_anchor(&record),
                vault_token: to_anchor(&ata(&record, &mint)),
                metadata: to_anchor(&metadata),
                token_program: to_anchor(&TOKEN_PROGRAM_ID),
                associated_token_program: to_anchor(&ATA_PROGRAM_ID),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        ),
        data: moon_stake::instruction::Stake {}.data(),
    };
    let err = send(&mut w.svm, &[ix], &owner, &[]).unwrap_err();
    assert!(
        !err.is_empty(),
        "fees must only go to the configured treasury"
    );
}
