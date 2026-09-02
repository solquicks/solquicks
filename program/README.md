# moon-stake

Escrow staking for the Moon Rangers collection (`MNRNG`).

**Status: devnet build in progress. Not deployed. Do not use with real NFTs yet.**

## What it does

Moves a Moon Ranger into a program-owned vault and records who deposited it.
Withdrawal always pays back to the recorded depositor.

Points are deliberately **not** handled here — they stay off-chain in the
points worker. This program only custodies NFTs, which keeps it small enough to
read end to end.

## Safety properties

These are the reasons to trust it, and each one should be checked by a reviewer:

1. **The program cannot send an NFT anywhere except back to its depositor.**
   There is no instruction that transfers to an arbitrary address. `unstake`
   and `emergency_return` both pay to `stake_record.owner`, which is written
   once at deposit and never updated.
2. **The admin cannot take an NFT.** `emergency_return` is admin-callable but
   still hard-wired to the recorded owner. It exists so a stuck NFT can be
   pushed home, not so it can be seized.
3. **Pausing cannot trap anyone.** `unstake` deliberately does not check the
   paused flag, so a pause stops new deposits only.
4. **Only real Moon Rangers can be staked.** The metadata account is checked to
   be the correct PDA, owned by Token Metadata, with a *verified* collection
   matching config. The client cannot assert membership.
5. **Vault rent returns to the owner** when the vault closes on unstake.

## Known trade-offs

- **Escrow, not freeze.** The NFT leaves the holder's wallet. Chosen so staking
  feels real. The cost is that a program bug is worse here than with a
  freeze-in-place design, where the NFT would never move.
- **Upgrade authority is retained** initially so bugs can be patched. That is
  centralisation, accepted deliberately; move it to a multisig once proven.

## Before mainnet

- [ ] Unit tests covering the abuse paths, not just the happy path
- [ ] Fuzz the metadata parser with malformed accounts
- [ ] `/audit-solana` pass
- [ ] Independent human review
- [ ] Devnet soak
- [ ] Mainnet staged: owner's own Rangers → a few holders → open

## Layout

- `programs/moon-stake/src/lib.rs` — the program
- `read_collection()` parses Metaplex metadata by hand; its offsets were
  validated against two live Moon Rangers before use
