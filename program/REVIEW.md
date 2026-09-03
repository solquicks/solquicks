# moon-stake — review brief

Thanks for looking at this. It should be a 1–2 hour read; the program is
deliberately small so it can be read end to end in one sitting.

**What it is:** an escrow staking program for the Moon Rangers NFT collection
(436 items, ~1 SOL floor). Holders deposit a Ranger, it sits in a program-owned
vault, they withdraw it later. Points are awarded off-chain and are **not** in
this program — it only custodies NFTs.

**Status:** deployed to devnet, never touched a real Ranger. 16 tests passing.

---

## The one file

`programs/moon-stake/src/lib.rs` — ~490 lines including comments.

Four instructions matter:

| Instruction | Who can call it | What it does |
|---|---|---|
| `stake` | any holder | takes a fee, moves the NFT into a vault, writes a stake record |
| `unstake` | the recorded depositor only | returns the NFT, closes the vault and record |
| `emergency_return` | admin only | returns the NFT **to the recorded depositor** |
| `set_treasury` / `set_fee` / `set_paused` | admin only | config |

---

## What I'd most like you to try to break

These are the claims the design rests on. If any is false, that's the finding.

1. **No path sends an NFT anywhere except back to its depositor.**
   `stake_record.owner` is written once at deposit and never updated. Both exit
   paths pay it. Is there any way to make an NFT leave the vault to a different
   address?

2. **The admin cannot take an NFT.** `emergency_return` is admin-gated but
   hard-wired to the recorded owner. Can an admin construct a call that lands a
   Ranger somewhere they control?

3. **Pausing cannot trap an NFT.** `unstake` deliberately does *not* check the
   paused flag. Verify that's actually true in the code and not just intended.

4. **Only genuine Rangers can be staked.** `verify_collection_member` checks the
   metadata account is the right PDA, owned by Token Metadata, with a *verified*
   collection matching config. Can a fake NFT get past this?

5. **`read_collection` (~line 230) is the riskiest function.** It hand-walks the
   Metaplex borsh layout with raw offsets over attacker-influenceable bytes.
   Every offset is `checked_add` and every read is `data.get()`, so the intent is
   that malformed data returns `None` rather than panicking or misreading. Offsets
   were validated against two live mainnet Rangers — but this is where I'd expect
   a bug to be if there is one.

6. **Fee handling.** Fees must go only to `config.treasury`. Can a caller
   redirect them, or stake without paying?

---

## Running it

```bash
cd program
avm use 1.1.2          # 0.31 ships Rust 1.79 and won't build current deps
anchor build
cargo test --package moon-stake
```

Tests are in `programs/moon-stake/tests/staking.rs` and are mostly attacks
rather than happy paths — a stranger unstaking someone else's Ranger, a thief
redirecting the payout, counterfeit and unverified-collection NFTs, forged
metadata at the wrong PDA, double staking, admin self-dealing, fee diversion.
If you think of an attack that isn't covered, that's the most useful thing you
could tell me.

---

## Known and accepted, so don't waste time on these

- **Escrow rather than freeze-in-place.** Freeze was available (the mint's
  freeze authority is the Master Edition PDA) and would have been safer, but
  escrow was chosen deliberately so staking feels real. The mitigations above
  exist because of that choice.
- **Upgrade authority is retained** so bugs can be patched. Centralised on
  purpose while the operator and holders are a small group; moves to a multisig
  before opening publicly.
- **No fuzzing yet** — planned, `read_collection` is the target.
- Points, accrual and the leaderboard are all off-chain by design.

Full audit notes: `docs/security-audit-2026-09-01.md`.
