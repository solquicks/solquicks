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

**14. Booking API, end to end — added 2026-09-14.** `worker/test/booking-api.test.mjs`,
90 assertions. Imports the real worker and calls its real fetch handler, backed
by a real SQLite database built from `schema.sql`, a fake clock and a fake
chain. Every refusal, both payment paths, expiry, replayed and short payments,
SOL sent instead of USDC, holder pricing, and the rate limit. Checked by
mutation: eleven deliberate bugs in the booking code, all eleven caught.

**15. `schema.sql` could not rebuild production.** It had 11 of the 35 tables
and indexes the live database uses — `bookings`, `banner_bookings` and
`rate_limits` among the missing. Recovered from the live D1 schema (structure
only) and verified to rebuild all 35 column-for-column. **Anything created by
hand in the Cloudflare dashboard has to be added there too**, or a rebuild
silently loses it. The booking test builds from this file, so CI now notices
if a table the booking code needs goes missing.

### Bugs the booking test proved — fixed 2026-09-14

**A. ~~A paid booking could be lost.~~** The payment page promised *"If you pay
and this page closes, the payment is still found"*, but only the open tab ever
looked, and it gave up after five minutes. Now:
- the scheduled job looks for payments on every held or recently expired
  booking from the last 48 hours, every 30 minutes;
- a payment that lands after its hold ended is **honoured if the hour is still
  ahead and free** (your decision), and otherwise marked `refund` with a
  Telegram alert — "💸 Refund needed", with the payer and signature. Refunds
  show in `/api/admin/bookings`;
- the page counts the hold down, greys the QR and disables paying when it ends,
  and keeps checking for five minutes after.

**B. ~~Two people could hold the same hour.~~** The insert now re-checks for an
overlapping booking inside the same statement, so only one of two simultaneous
holds can land. Proven: without the guard, five simultaneous holds for one hour
all succeeded; with it, one.

**C. ~~A raced duplicate confirm returned a 500.~~** It now gets a plain refusal.
The page and the wallet noticing one payment at the same moment no longer show
the customer an error either.

**D. ~~The ad slot had the same bugs, and one worse.~~ Fixed 2026-09-14.** Ads now
settle through the same code as bookings, so every fix above applies to them.
The worse one: **nothing ever expired an abandoned ad hold**, and each new run
starts when the last held or paid one ends — so a single abandoned four-week
checkout would have pushed every later advertiser back 29 days, permanently,
and each further one would stack. No ad had been booked yet, so nothing was
affected. Two advertisers arriving together were also sold the identical run;
the second is now placed on the next free run instead.

**E. ~~The banner sat empty where an abandoned hold dropped out.~~ Fixed 2026-09-14.**
A new run now takes the earliest start, at least a day out, where it fits —
not "after the last run". Each length gets its own date on the form, because a
shorter run can fit a gap a longer one cannot. Advertisers already queued are
never moved: those are dates they were given. One limit is inherent: a gap is
always a little shorter than the run that left it (anyone booking later starts
later), so it is filled by shorter runs, and a sliver under a week can stay
empty.

Still untested: the site itself has no browser test.

---

## Swap — shipped 2026-09-14

**16. The fee now lands on most swaps.** It used to be collected only on swaps
*into* SOL, USDC or PYUSD, so SOL into any other token earned nothing. It can
also be taken from the token being *sold*: proven by simulating on mainnet
(exactly 0.2% of the SOL sold reached the fee account, the buyer received 99.8%
of the no-fee amount, so charged once), and again on the live server after
deploy. Now any swap with SOL or USDC on either side, or PYUSD as the output,
earns. Still earns nothing: swaps between two tokens neither of which is SOL,
USDC or PYUSD-out (e.g. BONK → WIF).

**17. Jupiter API key — done 2026-09-15.** Jupiter is retiring
`lite-api.jup.ag`, which the swap uses, by cutting its rate limit step by step
(no date given). The replacement allows keyless callers about one request every
two seconds, shared by every visitor — too little for a busy swap. The worker
switches over automatically the moment a key exists:
1. Create a free key at portal.jup.ag.
2. In `worker/`, run `npx wrangler secret put JUPITER_API_KEY` and paste it.
Nothing needs redeploying.

**18. Shipped:** PYUSD / Token-2022 balances; "Your tokens" with dollar values at
the top of the token picker; Favourites, Recent and Popular sections; 25% / 50% /
Max; "After this swap" preview; recent pair chips; the price refreshes every 15
seconds, warns when it has moved, and a stale price is re-checked before
signing; swap history (read off the chain, with points, older swaps backfilled).
Hiding spam tokens (#6) was skipped by choice, so airdropped junk appears at the
bottom of "Your tokens", marked unverified.

**19. Limit orders and recurring buys — PARKED 2026-09-15 (your decision).**
Researched against Jupiter's live docs and API before building:
- *Trigger v2* (current; limit orders and recurring buys in one API): **no
  integrator fee** — Jupiter's docs say "Not currently, and there is no timeline
  for adding them" — and **custodial**: each wallet's tokens move into a vault
  managed by Privy for Jupiter. Needs the API key (#17) plus a sign-in step.
- *Trigger v1* (legacy limit orders): still live and removed from Jupiter's docs.
  Builds orders with a fee account attached, but collection happens when a
  keeper fills the order, which cannot be simulated — only a real filled order
  would prove it, and a wrong fee setting could stop orders filling. Recurring
  v1 no longer answers. $5 minimum.
Revisit when Jupiter adds integrator fees to Trigger v2.

**20. Round four — shipped 2026-09-15** (ideas taken from Titan while its API is
pending): Moon Rangers pay half the fee (10 bps), checked against the signing
wallet when the swap is built; savings shown per swap and in history; the route
each swap takes; Normal / Fast / Turbo priority fees; Auto slippage set from each
token's liquidity; token details (market cap, liquidity, holders, 24h move);
share links and receipt images; a weekly volume leaderboard paying 500 / 250 / 100
Fox Points to the top three wallets with at least $25 swapped (Monday to Monday
UTC). Prize amounts and the minimum are constants in the worker.

**21. Bot protection — shipped 2026-09-15, off by default.** With it on, the swap
gets a 0.000005 SOL tip added and is sent through Helius Sender with
`mev-protect`, so sandwich bots cannot trade around it. Proven by building a real
swap in the browser and simulating on mainnet: it costs the payer exactly the tip
and nothing else changes. Wallets that can only sign-and-send, or a swap too big
to take the extra instruction, go the normal way. ← Try one real swap with it on;
if it lands, consider making it the default.

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
