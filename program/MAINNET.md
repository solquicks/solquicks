# moon-stake — mainnet cutover runbook

Off-chain staking is a database row. The escrow vault is a real account holding
a real Ranger. For a while both exist, and the whole risk of this cutover is
that the two records disagree — someone earning points off-chain for a Ranger
that is also sitting in the vault, or the reverse. The order below exists to
make that window impossible, not just short.

**Nothing here is reversible except by another transaction. Do not skip the
verification step at the end of each phase.**

---

## Fixed values

| | |
|---|---|
| Program ID | `DSWFRcF4Ky9Nw7RQUUa2M9nnXD4kRrbYGjegF7dyJ9B5` |
| Config PDA | `52ukTqHvoPb6CBGgJSgGTpy8BBUrBBCNDsXaQR3K3nSM` (bump 254) |
| Collection | `5QuB6vy8181PG9g9SiQD6U7TfvuF9hcP9tAjj5DH79oz` |
| Treasury | `uPMPPQ3tEXWbAVaESSbERMHG9Yb2VvAq3XU6R5J8LUc` (solquicks.skr) |
| Admin | the Seeker — set by whoever signs `initialize` |
| Stake fee | 0.01 SOL per Ranger (10,000,000 lamports) |

Program keypair: `program/target/deploy/moon_stake-keypair.json`. **Back this up
before deploying.** Lose it before the first deploy and the program ID changes;
lose it after and nothing breaks, because upgrade authority is a separate key.

### Costs

| | |
|---|---|
| Program rent, exact size | **1.6643 SOL** (262,632-byte binary) |
| Program rent, 2× upgrade headroom | 3.3276 SOL |
| Config account rent | 0.0016 SOL |
| Deployer needs | **~1.8 SOL** (exact size) or ~3.5 SOL (headroom) |

Recommend exact size. A future upgrade that grows the binary can extend the
buffer then; paying 1.66 SOL now to avoid a maybe-later step isn't worth it.

Current balances (checked 2026-09-09): deployer
`Fwj6BE9ea7cexku9vhAwDwhhMsHN4bzzhnT2baKRayDk` has **0 SOL**; Seeker has
0.0219 SOL. Both need funding.

---

## Phase 0 — before anything touches mainnet

- [ ] **Tony has reviewed** `program/REVIEW.md`. This is the last point where a
      finding is cheap.
- [ ] **Docker installed** and `anchor build --verifiable` succeeds. Not
      installed as of 2026-09-09. A verifiable build lets anyone confirm the
      deployed bytes match this source; without it "trust me" is the only
      answer available. Skippable, but say so publicly if skipped.
- [ ] `cargo test --package moon-stake` — 28 passing (38 across the workspace).
- [ ] **Redeploy devnet first.** The 2026-09-12 audit moved the escrow vault from
      an associated token account to a program PDA, which changes the `stake`
      account list. The devnet program is still the old build, so the
      `?devnet=1` path will fail until it is upgraded. Test there before mainnet.
- [ ] **Close the orphaned devnet program.** `AbiL2mVBQgPbCujUuZFbdWXkHVAycriKjmQw16RiTKLG`
      is an earlier build still deployed and still upgradeable on devnet. Nothing
      points at it now, but anyone holding the old account list can still stake
      into it. `solana program close` it and reclaim the rent.
- [ ] `cargo clippy --all-targets -- -D warnings` clean.
- [ ] Program keypair backed up somewhere that is not this laptop.
- [ ] Deployer funded with ~1.8 SOL.
- [ ] Seeker funded with ~0.05 SOL for the init transaction.

**Decide upgrade authority before deploying**, because the answer changes the
deploy command:

- *Keep it on the deployer key* — bugs are patchable, and a laptop key can
  replace the program. This is the current stance in REVIEW.md and is honest
  only while the holder group is small.
- *Move it to the Seeker* — patchable only with hardware in hand.
- *Discard it* — immutable, unpatchable. Do not do this before the program has
  held real Rangers for a while.

Recommend deploying with the deployer key, then transferring upgrade authority
to the Seeker once initialisation is verified, so a laptop compromise cannot
replace the program.

---

## Phase 1 — deploy

```bash
cd program
solana config set --url mainnet-beta
solana balance                       # expect ~1.8 SOL
anchor build --verifiable            # or: cargo build-sbf
solana program deploy target/deploy/moon_stake.so \
  --program-id target/deploy/moon_stake-keypair.json
```

Verify before continuing:

```bash
solana program show DSWFRcF4Ky9Nw7RQUUa2M9nnXD4kRrbYGjegF7dyJ9B5
```

Expect the program ID, an upgrade authority you recognise, and a data length of
262,632. If the deploy dies partway it leaves a buffer account holding your SOL
— `solana program show --buffers` and `solana program close <buffer>` reclaims
it. Resume with the same command; don't start over.

> **Go straight to Phase 2.** `initialize` is permissionless and this program ID
> is public in the repo, so from the moment the deploy lands until you
> initialise, anyone watching mainnet could call it first and install themselves
> as admin. Nothing can be stolen during that window — no Ranger can be staked
> until the config exists — but a front-run would mean redeploying under a new
> ID or patching via the upgrade authority. Have the init page already open on
> the Seeker before you run the deploy command, and don't take a break between
> the two phases.

---

## Phase 2 — initialise, from the Seeker

`initialize` is what makes the signing wallet the permanent admin, so it must be
signed by the Seeker, not by a laptop key. That rules out a CLI script — hence
a browser page.

1. Commit and push `stake-init.html`.
2. Open **https://solquicks.com/stake-init.html** on the Seeker, inside the
   wallet app's browser. It must be that domain — the RPC proxy's CORS
   allowlist contains only `https://solquicks.com`, so the page will fail to
   reach the chain from anywhere else, localhost included.
3. Connect the Seeker. **The wallet you connect becomes admin.**
4. Run the pre-flight checks. They confirm the program is deployed, the config
   does not already exist, and the wallet has SOL.
5. Confirm the three fields against the table at the top of this file.
6. Initialise. The page simulates first and refuses to send if simulation fails.

Verify:

```bash
solana account 52ukTqHvoPb6CBGgJSgGTpy8BBUrBBCNDsXaQR3K3nSM
```

The page will not let you initialise twice, and neither will the chain — the
config PDA can only be created once. If the treasury or fee is wrong, that is
recoverable: `set_treasury` and `set_fee` fix them. **A wrong admin is not
recoverable without the wrong admin's signature**, so check that field hardest.

Once verified, if you chose to move upgrade authority:

```bash
solana program set-upgrade-authority DSWFRcF4Ky9Nw7RQUUa2M9nnXD4kRrbYGjegF7dyJ9B5 \
  --new-upgrade-authority uPMPPQ3tEXWbAVaESSbERMHG9Yb2VvAq3XU6R5J8LUc
```

---

## Phase 3 — settle the off-chain stakers

Run this **before** flipping the site over, so nobody is mid-flight.

```bash
cd program/migration
node settle-stakers.mjs              # dry run, changes nothing
node settle-stakers.mjs --commit     # writes settle.sql
```

Dry run as of 2026-09-09: 1 wallet, 4 Rangers, ~25 points preserved, 4
`staked_nfts` rows to clear. The script stops the accrual clock (`staked = 0`)
while banking every point already earned — nobody loses anything, and nobody
keeps earning for a Ranger they haven't deposited into the vault.

The total climbs every minute the clock runs: two dry runs minutes apart
returned 22 and then 25. So generate `settle.sql` **at** cutover and apply it
immediately. A file generated hours earlier banks stale totals and quietly
shorts everyone the difference.

```bash
cd ../../worker
wrangler d1 execute solquicks-points --remote --file=../program/migration/settle.sql
```

Verify the leaderboard still shows the same totals it did before.

---

## Phase 4 — cut the site over

Order matters. Stop the old path first, then open the new one.

1. **Announce in Discord** that Sol Suite staking is closing, with a date.
   Holders must unstake at https://moonrangers.solsuite.io/staking themselves —
   nobody else can do it for them.
2. Stop off-chain staking:
   ```bash
   cd worker
   # set STAKING_ONCHAIN = "true" in the [vars] block of wrangler.toml
   wrangler deploy
   curl -s https://<worker>/api/health   # confirm BUILD is the new one
   ```
   `/api/stake` now returns 409 with an explanation. Unstaking still works, so
   anyone mid-position can get out.
3. Remove the `?devnet=1` gate in `index.html` so the staking UI points at
   mainnet.
4. **Stake one of your own Rangers as the first real test.** Confirm: fee
   arrives at the treasury, the Ranger appears in the vault, the stake record
   exists, and unstake returns it. Do this before telling anyone the new
   staking is live.

---

## If something goes wrong

| Symptom | What to do |
|---|---|
| Deploy fails partway | `solana program show --buffers`, then redeploy with the same command. Close orphaned buffers to reclaim SOL. |
| Simulation fails on init | Nothing was sent. Read the logs the page prints. |
| Config initialised with a wrong treasury or fee | `set_treasury` / `set_fee`, signed by the admin. |
| Config initialised with the wrong admin | Only that admin can call `set_admin`. If it's a key you hold, hand it over. If not, the config is stranded and the program needs a new one — which means an upgrade. |
| Someone front-ran `initialize` | `solana account <config PDA>` will show an admin that isn't yours. Nothing is at risk; no NFT can be staked yet. Use the upgrade authority to patch, or redeploy under a fresh program ID. Do **not** announce staking until `config.admin` reads as the Seeker. |
| A Ranger is stuck in a vault | `emergency_return`, admin only, and it can only return the NFT to the recorded depositor. |
| Staking needs to stop right now | `set_paused true`. `unstake` deliberately ignores the paused flag, so pausing can never trap anyone's NFT. |

---

## Deliberately not automated

Deploy and initialise are one-shot, irreversible, and cost real SOL. A script
that wraps them saves a few minutes once and removes the pause where you'd
notice a wrong address. The commands are short enough to read before running.
