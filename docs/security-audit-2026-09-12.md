# Solana Program Security Audit — moon-stake — 2026-09-12

**Program:** `moon-stake` · `DSWFRcF4Ky9Nw7RQUUa2M9nnXD4kRrbYGjegF7dyJ9B5`
**Status:** devnet only — not deployed to mainnet
**Previous audit:** `docs/security-audit-2026-09-01.md`
**Companion:** `docs/audits/infra-2026-09-12.md` (everything around the program)

## Summary

| Severity | Found | Fixed in this pass |
|---|---|---|
| Critical | 0 | — |
| High | 1 | 1 |
| Medium | 1 | 1 |
| Low / informational | 3 | 0 (accepted or scheduled) |

Tests: **28 passing for moon-stake** (was 27), 38 across the workspace. Formatting clean. `cargo build-sbf` clean.
No `unwrap`, `expect`, `panic!` or unchecked arithmetic anywhere in program
source — verified with clippy's `unwrap_used`, `expect_used`, `panic` and
`arithmetic_side_effects` lints, all zero.

---

## [HIGH] AUDIT-01: A stranger could permanently block any Ranger from being staked — FIXED

**Category:** Denial of service · STRIDE-DoS · **Confidence:** 10/10 (exploit written and run)

### What was wrong

The escrow vault was an **associated token account**:

```rust
#[account(init, payer = owner,
          associated_token::mint = nft_mint,
          associated_token::authority = stake_record)]
pub vault_token: Account<'info, TokenAccount>,
```

Anyone can create an associated token account for **any** owner and mint —
including for a PDA that does not exist yet. `init` fails if the account already
exists. So a stranger could create the vault address first, and staking that
Ranger would fail forever.

### Proof

A test was written that performs the attack. Against the old code:

```
AUDIT: stranger created the vault address first: true
AUDIT: staking FAILED after squatting — "InstructionError(0, IllegalOwner)"
```

### Why it mattered

- **Cost to the attacker:** one rent-exempt token account per Ranger, about
  0.002 SOL — roughly **$45 to block the entire 219-item collection**.
- **Permanent.** The squatted account's authority is the stake-record PDA, which
  does not exist and cannot sign, so nobody — not the attacker, not the admin —
  can close it. Recovery would require a program upgrade.
- **No theft.** Nothing could be stolen; this destroys the feature, not funds.

### The fix

The vault is now a PDA of the staking program itself:

```rust
#[account(init, payer = owner,
          seeds = [b"vault", nft_mint.key().as_ref()], bump,
          token::mint = nft_mint,
          token::authority = stake_record)]
pub vault_token: Account<'info, TokenAccount>,
```

Only this program can create an account at its own PDA. `init_if_needed` was
deliberately **not** used — it is on the project's banned list for
reinitialisation reasons, and it is not needed once the address cannot be taken.

The associated token program account was dropped from `stake` — it is no longer
used, so it was removed from the instruction rather than left as dead weight.

Kept as a regression test: `a_stranger_cannot_occupy_the_vault_address`, which
asserts the squat now fails and that staking still works.

---

## [MEDIUM] AUDIT-02: The site's on-chain staking pointed at a stale program — FIXED

**Category:** Misconfiguration · **Confidence:** 10/10

`index.html` had `programId: 'AbiL2mVBQgPbCujUuZFbdWXkHVAycriKjmQw16RiTKLG'`
while the program declares `DSWFRcF4Ky9Nw7RQUUa2M9nnXD4kRrbYGjegF7dyJ9B5`.
**Both are deployed on devnet**, so the `?devnet=1` path was silently driving an
older build — every PDA the client derived belonged to the wrong program.

Impact was limited to the opt-in devnet path, but it would have become a mainnet
bug the moment that gate was removed, which `program/MAINNET.md` schedules as a
cutover step. Corrected, with a comment tying the constant to `declare_id!`.

---

## [LOW] AUDIT-03: `initialize` is permissionless — accepted, mitigated operationally

Unchanged from the design note in the source. Anyone can call `initialize`
between deploy and setup and become admin. Pinning the key would make every
admin path untestable, since the tests cannot sign as a hardware wallet.

Worth restating precisely, because the infrastructure audit found a leaked
keypair in git history: **the leaked key is `9vVtZ3Qd…`, an abandoned address
with nothing deployed at it. The current program keypair has never been
committed.** So this window is the ordinary one every program has, not one
widened by the leak. Closed operationally — initialise immediately after
deploying and check `config.admin` before anything else.

## [LOW] AUDIT-04: `rkyv` advisory reaches moon-draw, not moon-stake

`cargo audit` reports **RUSTSEC-2026-0235** — out-of-bounds reads on malformed
archives in `rkyv 0.7.46`. It arrives through
`ephemeral-rollups-sdk 0.17 → magicblock-delegation-program-api`, which is a
dependency of **moon-draw** (the VRF draw), not moon-stake. moon-draw is not
deployed anywhere and its first use is the Q1 2027 mission.

Action: upgrade `ephemeral-rollups-sdk` before moon-draw is deployed, or confirm
the vulnerable code path is unreachable from the instructions used. Not a
blocker for the moon-stake mainnet deploy.

Also reported, all unmaintained-crate warnings rather than vulnerabilities, all
from the Solana/Anchor tree: `libsecp256k1`, `paste`, `rand 0.7.3`, and four
others. Nothing actionable at our level.

## [LOW] AUDIT-05: `emergency_return` lets the admin end anyone's stake

The admin can return any staked Ranger to its owner at any time. It cannot be
redirected — the destination is `address = stake_record.owner` — so it is not a
theft path, but it is a griefing path: the admin could unstake everyone and stop
their points accruing. Accepted, and already documented in `REVIEW.md` as the
cost of having an escrow that can be unwound when someone loses access.

---

## Checklist results

### Account validation — pass
- Every privileged instruction requires a `Signer`. `set_admin` requires **two**
  signatures, so admin cannot be handed to a key that never proved it exists.
- `config` and `stake_record` are validated by seeds with **stored canonical
  bumps** (`bump = config.bump`, `bump = stake_record.bump`) — never recalculated.
- `treasury` is constrained `address = config.treasury`, so fees cannot be
  redirected by passing a different account.
- `unstake` requires the signer to be `address = stake_record.owner`. The
  recorded owner is written once at deposit and never updated.
- `emergency_return` sends to `address = stake_record.owner` — admin cannot
  redirect an NFT to themselves. Covered by `admin_cannot_steal_via_emergency_return`.
- Metadata is validated three ways before it is trusted: the account must be the
  correct PDA for the mint, owned by Token Metadata, and carry a **verified**
  collection matching config.
- `init` is used, never `init_if_needed` — no reinitialisation path.

### Arithmetic — pass
The only arithmetic is `total_staked` using `saturating_add` / `saturating_sub`,
a display counter. `read_collection` uses `checked_add` and `checked_mul` on
every offset. Clippy's `arithmetic_side_effects` lint reports zero.

### CPI — pass
`token_program` is `Program<'info, Token>` and `system_program` is
`Program<'info, System>`, so the program IDs are type-checked; no user-supplied
program can be invoked. PDA signing uses the stored bump. No account is read
after a CPI in a way that would depend on stale data, so no `reload()` is needed.

### Untrusted deserialisation — pass, and fuzzed
`read_collection` hand-walks the Metaplex layout across attacker-influenceable
bytes. Every offset is checked, every read is `data.get()`, and malformed input
returns `None` instead of panicking. The crate carries a `parser_fuzz` module
that feeds it mutated and truncated metadata.

### Type cosplay / account revival — pass
Anchor's `Account<'info, T>` checks discriminators. `close = owner` handles the
revival-safe close. The vault is closed through the SPL token program.

### Seed collisions — pass
Three distinct prefixes: `config`, `stake`, and now `vault`. No shared space.

---

## Not done — required before mainnet

1. **Trident fuzzing.** The parser has property tests, but the instruction
   surface has not been fuzzed. `/audit-solana` asks for this before mainnet.
2. **Verifiable build.** `anchor build --verifiable` needs Docker, which is not
   installed. Without it nobody can confirm the deployed bytes match this source.
3. **Devnet redeploy.** The vault change alters the `stake` account list. The
   devnet program must be upgraded before the `?devnet=1` path works again —
   the client has already been updated to match.
4. **Professional audit.** This program takes custody of other people's NFTs.
   An independent review (OtterSec, Neodyme, Zellic) is the right call before it
   holds anything valuable.

## Diff vs 2026-09-01

- **New:** AUDIT-01 (high, fixed), AUDIT-02 (medium, fixed), AUDIT-04 (rkyv).
- **Resolved since:** the missing `set_admin` handover, which that audit's
  successor added; tests grew 16 → 38.
- **Persistent:** AUDIT-03 permissionless `initialize`, AUDIT-05 admin
  `emergency_return` — both accepted with reasons recorded.

## Independent review of the fix

The vault change was re-reviewed by a separate reviewer that had not written it,
against five specific questions. It found **no exploitable vulnerability** and
confirmed the fix holds — including that pre-funding the new vault PDA with a
bare lamport transfer does not brick `init`, because Anchor 1.1.2 falls through
to transfer + allocate + assign signed with the PDA seeds. So the address cannot
be occupied by any means.

Two things it raised that are worth recording:

- `unstake` and `emergency_return` constrain the vault only by mint and owner,
  not by the canonical `["vault", mint]` PDA. Traced and **not exploitable** —
  `release_nft` requires `vault_token.amount == 1`, and the payout destination is
  pinned to `stake_record.owner` twice over. Note this constraint set is
  unchanged by the fix; it was equally loose when the vault was an ATA. Pinning
  the seeds there is still worth doing as defence in depth.
- The orphaned devnet build at `AbiL2mVB…` is still deployed and upgradeable.
  Nothing points at it, but it should be closed rather than left around; added to
  the mainnet runbook.

## Sign-off

- [x] All critical issues resolved — none found
- [x] All high issues resolved — AUDIT-01 fixed and regression-tested
- [ ] Ready for mainnet — **not yet**: fuzzing, verifiable build and a devnet
      redeploy of the new vault layout are outstanding
