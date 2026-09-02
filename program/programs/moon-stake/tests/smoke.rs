use litesvm::LiteSVM;
use solana_address::Address;
use solana_keypair::Keypair;
use solana_signer::Signer;

pub fn program_id() -> Address {
    Address::new_from_array(moon_stake::ID.to_bytes())
}

#[test]
fn program_loads() {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(program_id(), "../../target/deploy/moon_stake.so")
        .expect("program .so should load — run `anchor build` first");
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    assert!(svm.get_account(&program_id()).is_some());
}
