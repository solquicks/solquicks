# moon-stake security audit

**Date:** 1 September 2026
**Program:** `moon-stake` (Moon Rangers escrow staking)
**Devnet program id:** `AbiL2mVBQgPbCujUuZFbdWXkHVAycriKjmQw16RiTKLG`
**Auditor:** Claude (automated + manual review). **This is not a professional audit.**

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 (fixed) |
| Accepted risks | 3 |

No critical or high findings. One low finding was fixed during the audit. Three
risks are accepted by design and documented below rather than fixed.

## Findings

### LOW-1 — unchecked offset arithmetic in the metadata parser *(fixed)*

`read_collection()` used `o + 4`, `o + 1`, `o + 2`, `o + 34` when slicing the
metadata buffer. With `overflow-checks = true` these would abort the
transaction rather than wrap, so impact was denial-of-service at worst, on an
attacker's own transaction. Replaced with `checked_add` throughout. Verified by
re-running the suite.

## Accepted risks

### AR-1 — escrow custody

The NFT leaves the holder's wallet. A program bug can therefore strand someone
else's asset. Chosen deliberately by the owner over freeze-in-place, which was
verified available for this collection (mint freeze authority is the Master
Edition PDA `CqFwJJvcq42g1eLApkWvsHDGhfyg62S2T9vvaRmJSRTt`).

Mitigations: `emergency_return`, retained upgrade authority, staged rollout.

### AR-2 — retained upgrade authority

Upgrade authority stays with `Fwj6BE9ea7cexku9vhAwDwhhMsHN4bzzhnT2baKRayDk` so
bugs can be patched. This is centralisation: the authority holder could deploy
code that moves staked NFTs. Accepted while the operator and holders are the
same small group. Move to a multisig before opening to the public.

### AR-3 — no fuzzing yet

Trident fuzzing has not been run. The metadata parser is the natural target,
since it walks attacker-influenced bytes. Its offsets were validated against two
live mainnet Rangers and it is fully bounds-checked, but fuzzing should happen
before mainnet.

## Verified properties

Each is covered by a passing test in `programs/moon-stake/tests/staking.rs`.

| Property | Test |
|---|---|
| Round trip returns the NFT | `stake_and_unstake_round_trip` |
| A stranger cannot unstake your NFT | `a_stranger_cannot_unstake_your_ranger` |
| Payout cannot be redirected to a thief | `a_thief_cannot_redirect_the_payout_to_themselves` |
| Another collection cannot be staked | `counterfeit_nft_is_rejected` |
| An unverified collection claim is refused | `unverified_collection_is_rejected` |
| An NFT with no collection is refused | `nft_without_a_collection_is_rejected` |
| Forged metadata at the wrong PDA is refused | `forged_metadata_account_is_rejected` |
| The same NFT cannot be staked twice | `the_same_ranger_cannot_be_staked_twice` |
| Pausing blocks new stakes but never traps one | `pausing_stops_new_stakes_but_never_traps_an_nft` |
| The admin cannot redirect an NFT to themselves | `admin_cannot_steal_via_emergency_return` |
| Emergency return sends the NFT to its owner | `emergency_return_sends_the_ranger_home` |
| A non-admin cannot trigger emergency return | `non_admin_cannot_call_emergency_return` |
| The fee reaches the configured treasury | `the_stake_fee_reaches_the_treasury` |
| The fee cannot be diverted elsewhere | `fee_cannot_be_diverted_to_another_wallet` |

## Checklist

- [x] Every account validated (Anchor constraints + explicit `address =` checks)
- [x] Signer verification on all privileged instructions
- [x] Canonical PDA bumps stored and reused, never recalculated
- [x] Discriminators checked (Anchor `Account<'info, T>`)
- [x] No `unwrap()` or `expect()` in program code
- [x] All arithmetic checked or saturating; `overflow-checks = true` in release
- [x] No raw `invoke` — all CPIs go through typed Anchor helpers
- [x] Accounts closed with Anchor's `close`, which handles revival
- [x] Distinct PDA seed prefixes (`config`, `stake`)
- [x] `cargo fmt` and `clippy` clean
- [x] 15/15 tests passing
- [ ] Trident fuzzing — **outstanding**
- [ ] Independent human review — **outstanding**
- [ ] Verifiable build — **outstanding**
- [ ] Devnet soak — **in progress from today**

## Before mainnet

1. Fuzz the metadata parser with Trident
2. Independent human review of `lib.rs` (~490 lines)
3. `anchor build --verifiable`
4. Devnet soak with real staking flows
5. Mainnet staged: owner's own 3 Rangers → a few holders → open
6. Move upgrade authority to a multisig before opening publicly
