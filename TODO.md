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

## P2 — collection integrity

**4. The two blank-name Rangers — investigated, probably unrecoverable.**
Full write-up in `docs/ranger-names.md`. Short version: every source that knew
their names is gone. The original IPFS metadata is unpinned ("no providers found
for the CID"), one Ranger's Arweave JSON 404s, the swap store is retired with no
surviving records, and Magic Eden's cached name for one of them contradicts both
its own traits and an existing Ranger. Trait matching recovers a known-correct
name only 13 times in 22, which is not good enough for a lifetime NFT.

Next step is people, not code: **ask the two owners**
(`78UTfQcwRxYC…` and `FRanc6ubzomv…`) whether they have a screenshot or listing,
and ask whoever ran the trait-swap store whether records survive. Failing that,
the choice is to restore their pre-swap identities (#290 and #236, both free) or
leave them blank. Nothing is broken by waiting — both display art and traits
fine.

**5. ~~Two Rangers share a name with another Ranger.~~ Fixed 2026-09-10.**
`GGTjnPNLjj…` is now Ranger #46 and `FAR6wZhvAk…` is now Ranger #205, each
taking back its own pre-swap identity. Re-read all 219 metadata accounts
afterwards: 217 distinct names, zero duplicates, creators and verified
collection intact. Worth a Discord note to those two owners — their Ranger's
number changed.

**Correction worth keeping:** the other 24 swapped Rangers whose names disagree
with their mint transaction are **correct**, not corrupt — their traits match
the assigned name's design far better (20 of 22, none the other way). An earlier
reading of this data said all 24 were wrong. Renaming them would have been a
serious mistake.

## P3 — revenue that already works but isn't collected

**6. Swap fees — investigated 2026-09-10, deliberately left to accrue.**

The 20 bps fee works and the money is provably yours: all three fee accounts in
`SWAP_FEE_ACCOUNTS` derive as `["referral_ata", 5Vrx9Gi4…, mint]`, and that
referral account's partner is `31jpe6JU…`. Its `shareBps` is **10000 — you keep
100%** of the fee, Jupiter takes nothing. (The Ultra account you also created is
8000 = 80%, so the site is on the better of the two.)

Balances at the time of checking: USDC 0.047564, wSOL 0.002245, PYUSD 0.29984 —
about **$0.57** total.

Not claimed, for two reasons:

- None of the three destination token accounts exist in `31jpe6JU…`, so claiming
  creates all three and locks **~0.00615 SOL (~$0.61)** in rent — more than the
  fees are worth. The rent is recoverable later (the cleanup tool reclaims
  exactly this), but it is not a trip worth making yet.
- `claim` pays the **partner**, and the partner is the hot wallet, not the
  Seeker.

Nothing is at risk while waiting: the fee accounts are owned by the referral
program and only the partner's own ATA can receive a claim.

**When you do want it**, the order matters. The Jupiter referral program has
`transferReferralAccount` (signed by the current partner, one transaction, empty
params). Because the fee-account PDAs derive from the *referral account* and not
the partner, transferring it to `solquicks.skr` routes both accrued and future
fees to the Seeker **with no change to the site at all** — `SWAP_FEE_ACCOUNTS`
stays exactly as it is. Transfer first, then claim.

`claim` is permissionless — only the `payer` signs, so it can be cranked at any
time, by anyone, once the balances justify the ~0.006 SOL of rent. Somewhere
north of $10 is when it starts being obviously worth it.

**7. ~~The plushie award is farmable.~~ Fixed 2026-09-09.**
The Buy Now click no longer awards anything. Points come from a code issued per
real order and burned on first use — see `docs/plushie-codes.md`. Verified end
to end against the live worker: the old exploit now returns `unknown award`, a
used code cannot be redeemed twice or by a second wallet.

**8. Book The Fox copy — done except MC / speaking. ← COME BACK TO THIS**

Reviewed one by one on 2026-09-11 and shipped: advertising space, Hosted X
Space, Hosted Podcast (now labelled "recorded"), Hosted Stream and Custom
content. Bookings and the ad slot are now paid in USDC only.

**Still open — MC or speaking ($1,000, in person).** Parked at your request. The
card never says whether travel is part of the $1,000, and that is the first
thing an organiser will ask. The options were:

- organiser covers travel and accommodation (the usual arrangement for
  flat-fee speaking — a $1,000 fee that has to cover a flight and a hotel can
  leave very little)
- travel included in the fee (simplest, but best only for local events)
- travel agreed per event (open, but stated plainly)

The copy also says "in person" and "flat fee" three times on one card, so it
gets tightened whichever way the travel answer goes.

---

**Store stock is typed in by hand.** "93 available" and "7 / 100" on the Store
tab matched store.fun exactly on 2026-09-11, but they are static text — the
first sale makes them wrong. Update them in `index.html` after a sale, or build a
live read from store.fun later (its page renders client-side, so that means
finding the API it calls, not scraping HTML).

---

## P4 — features, once the above is clean

**9. The 0.1 SOL collectible mint.**
Planned but never built. It needs its utility defined before any code: a mint
sold on the promise of unspecified future benefits is the shape regulators
treat as a security. Decide what a holder actually gets — a discount on Book The
Fox, a points multiplier, mission entries — and it becomes a straightforward
build.

**10. Q1 2027 mission pool size.**
Still undecided, and it sets the guaranteed-points share and the headline prize.
Not urgent, but it's the last open input on the missions design.

---

## Testing and CI — added 2026-09-12

**12. CI on every push and pull request.** `.github/workflows/ci.yml`, four jobs
gated by branch protection on `main`: secret scan, worker, site, Solana program.
Actions are pinned to commit SHAs rather than tags.

**13. Booking quote maths.** `worker/test/booking-quote.test.mjs`, 45
assertions, no dependencies and no network. It lifts `quoteFor`, `usdcUnits`
and the rush and discount constants out of the shipped worker source rather
than copying them, so a change to the pricing fails the test.

Two things it found that are worth remembering:

- The breakdown on the payment screen is built from its own expressions in
  `index.html`, not from the worker's total. They have to be changed together,
  and now a test says so.
- The cent rounding in `quoteFor` is currently a no-op — none of the five
  prices produce a fraction of a cent — so deleting it broke nothing. It is
  tested against hypothetical prices that would expose it. **If a price is ever
  set to something like $199 or $49.99, that rounding starts doing real work.**

Still untested: `/api/book` end to end (hold, expiry, double-booking), and the
site itself has no browser test.

---

## Blocked

**11. moon-stake mainnet.**
Needs ~1.8 SOL for program rent. Everything else is ready: 28 tests passing,
`stake-init.html` verified against the chain, `settle-stakers.mjs` dry-run
clean, runbook in `program/MAINNET.md`. Nothing expires — pick it up when the
SOL is there. Tony's review of `program/REVIEW.md` can happen meanwhile and
costs nothing.

---

## Where this stands

Done today: all of P0, the plushie leak, and `/api/migrate`. Both known ways to
mint points without earning them are closed.

Open, in the order I'd take them: **MC / speaking copy** (parked — needs your
travel decision, item 8), **the two blank names** (needs the owners or the
swap-store operator — not a code problem).
The swap fees are deliberately parked until they outgrow the rent. The mainnet
deploy sits blocked on ~1.8 SOL and nothing about it expires.

One consequence worth deciding on: points earned before signing in now vanish
when you connect, instead of carrying over. It's a handful of points from the
daily visit and the games, and you can earn them again immediately once signed
in — but if it bothers you, the cleaner fix is to stop awarding points to
signed-out visitors at all, so the site never shows a number it won't honour.
