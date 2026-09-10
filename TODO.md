# solquicks.com — what's next

Written 2026-09-09. Everything here was verified against the live site, the
deployed worker, or mainnet — not from memory. Ordered by what unblocks the
most for the least money, since the mainnet deploy is on hold.

---

## P0 — done 2026-09-09

**1. Commit and push this session's work.**
Nine files are sitting uncommitted on `main`, including the whole mainnet
preparation. If this laptop dies, that's gone.

```bash
cd /Users/solquicks/Developer/solquicks.com
git checkout -b chore/mainnet-prep-09-09-2026
git add -A && git commit && git push -u origin chore/mainnet-prep-09-09-2026
```

**2. Deploy the worker.**
Live is `cleanup-rows-1`; local is `onchain-ready-1`. The `STAKING_ONCHAIN`
cutover switch and its `[vars]` entry aren't live yet. Deploying changes no
behaviour today — the flag defaults to `"false"` — it just puts the switch in
place so the cutover is one edit later. Confirm `/api/health` reports the new
build afterwards; a deploy can report success while serving stale code.

**3. Delete `migrate.html`.**
Still returns 200 at https://solquicks.com/migrate.html. The migration is done.
It's a transaction-signing page gated to the update authority, so it isn't a
hole, but a signing page with no remaining purpose shouldn't stay reachable.

---

## P1 — ~~`/api/migrate` hands out 5,000 points~~ Removed 2026-09-09

`POST /api/migrate` credited a points number sent by the client, capped at
5,000, once per wallet. It existed to carry over points earned in the browser
before a wallet was connected — but the browser reports that number, so it could
never be told apart from an invented one. Demonstrated live: a brand-new wallet
asked for 5,000 points and went straight to the top of the leaderboard.

The endpoint is gone, along with `MAX_MIGRATE` and the `migrated` flag. The
browser-side tally is now discarded on sign-in rather than carried over. Fresh
wallets get a 404. Verified against the live worker; the demo wallet was removed
from D1.

## P2 — collection integrity (~0.002 SOL)

**4. The two blank-name Rangers.**

| Mint | State |
|---|---|
| `oVPyKLZbvJGQAZWZ7U3bNF4thFT2cRZoNYMtH86YT4F` | name `""` |
| `GVJWmz3N8jPVu6AFHPe7LvQSY7tnKizK4m7j9BJkjMY2` | name `""` |

Not migration damage — the name was already empty in the source, and the
migration copied it faithfully. Both are otherwise complete: full traits, valid
image, correct 3% royalty. Only `name` and `description` are empty, in **both**
the on-chain metadata and the Arweave JSON, so fixing it means re-uploading the
JSON and then one `UpdateMetadataAccountV2` each.

The blocker is identification: nothing on chain says which numbers these are.
`oVPyKLZ…` carries Background Isle / Fur Green / Eyes Stone / Flight Jacket
Galaxy / Mouth Moon Breather / Head Ranger Helmet / Moon Gun Rifle, Rarity Rank
697. **I need your original metadata files to match that trait set to a number.**
I won't guess a name onto a lifetime NFT.

---

## P3 — revenue that already works but isn't collected

**5. Claim the swap fees, and decide where they should land.**
The 20 bps fee is working on mainnet — real money has accrued:

| Token | Balance |
|---|---|
| USDC | 0.047564 |
| SOL | 0.000465 |
| PYUSD | 0.299840 |

About $0.40 total, so this is proof-of-mechanism rather than income. Two
decisions: claim it through Jupiter's referral dashboard, and decide whether the
referral account should keep paying out to `31jpe…` or be repointed to the
Seeker like everything else.

**6. ~~The plushie award is farmable.~~ Fixed 2026-09-09.**
The Buy Now click no longer awards anything. Points come from a code issued per
real order and burned on first use — see `docs/plushie-codes.md`. Verified end
to end against the live worker: the old exploit now returns `unknown award`, a
used code cannot be redeemed twice or by a second wallet.

**7. Book The Fox descriptions.**
You said you'd circle back to these. Send me the wording you want and I'll
update them.

---

## P4 — features, once the above is clean

**8. The 0.1 SOL collectible mint.**
Planned but never built. It needs its utility defined before any code: a mint
sold on the promise of unspecified future benefits is the shape regulators
treat as a security. Decide what a holder actually gets — a discount on Book The
Fox, a points multiplier, mission entries — and it becomes a straightforward
build.

**9. Q1 2027 mission pool size.**
Still undecided, and it sets the guaranteed-points share and the headline prize.
Not urgent, but it's the last open input on the missions design.

---

## Blocked

**10. moon-stake mainnet.**
Needs ~1.8 SOL for program rent. Everything else is ready: 27 tests passing,
`stake-init.html` verified against the chain, `settle-stakers.mjs` dry-run
clean, runbook in `program/MAINNET.md`. Nothing expires — pick it up when the
SOL is there. Tony's review of `program/REVIEW.md` can happen meanwhile and
costs nothing.

---

## Where this stands

Done today: all of P0, the plushie leak, and `/api/migrate`. Both known ways to
mint points without earning them are closed.

Open, in the order I'd take them: **the two blank-name Rangers** (needs your
original files), then the swap fees and the Book The Fox wording. The mainnet
deploy sits blocked on ~1.8 SOL and nothing about it expires.

One consequence worth deciding on: points earned before signing in now vanish
when you connect, instead of carrying over. It's a handful of points from the
daily visit and the games, and you can earn them again immediately once signed
in — but if it bothers you, the cleaner fix is to stop awarding points to
signed-out visitors at all, so the site never shows a number it won't honour.
