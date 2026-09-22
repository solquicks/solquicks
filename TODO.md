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

**8. Book The Fox copy — done 2026-09-15.** Every card reviewed and shipped. MC or
speaking ($1,000, in person) now says your travel is included in the fee (your
decision), and only the date and venue are agreed before payment.

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

**19. Limit orders and recurring buys — DROPPED 2026-09-15 (your decision).**
Jupiter pays sites nothing on them (Trigger v2 has no integrator fee) and holds
users' tokens in its own vault. Titan's order API does allow a platform fee, but
it is custodial in the same way and needs partner onboarding.

**20. Round four — shipped 2026-09-15** (ideas taken from Titan while its API is
pending): Moon Rangers pay half the fee (10 bps), checked against the signing
wallet when the swap is built; savings shown per swap and in history; the route
each swap takes; Normal / Fast / Turbo priority fees; Auto slippage set from each
token's liquidity; token details (market cap, liquidity, holders, 24h move);
share links and receipt images; a weekly volume leaderboard paying 500 / 250 / 100
Fox Points to the top three wallets with at least $25 swapped (Monday to Monday
UTC). Prize amounts and the minimum are constants in the worker.

**22. Spam hidden in the token picker — shipped 2026-09-15.** "Your tokens" hides a
token only when it is unverified *and* worth under a cent (no price counts as no
value). Unverified tokens with a real price stay. "Show N unverified tokens with
no value" brings them back, and search still finds everything.

**23. Browser test — added 2026-09-15.** `test/browser/site.test.mjs` loads the
page in Chromium with a stand-in wallet and stand-in servers and clicks through
it: every tab, a swap quote, spam hiding, a normal swap and a bot-protected one,
settings surviving a reload, no page errors and nothing blocked by the page's
security policy. Runs in the Site CI job. Checked by breaking the site three ways
(Sender removed from the security policy, the spam rule disabled, a script error
in the swap tab); each one failed the test.

**24. Titan — DROPPED 2026-09-15 (your decision).** Charging our fee through Titan
needs the Titan team to approve the fee account, on top of a paid Triton or
QuickNode plan. Swaps stay on Jupiter, which pays the fee with no approval.

**25. Every swap earns — shipped 2026-09-15.** A pair with no fee account on either
side (BONK → WIF, ENT → WIF, PYUSD → anything) now pays the same 0.2% (0.1% for
Moon Rangers) as a SOL transfer to the treasury, added to the transaction the
wallet signs. The worker sets the amount from Jupiter's dollar value and the SOL
price; the page skips it if the wallet would be left under 0.005 SOL, and the
swap still goes through. History, savings and the weekly leaderboard read it
back from the chain; a transfer well under the holder rate does not count as a
fee. Proven on mainnet: ENT → WIF with the fee added simulated cleanly, the payer
paid exactly the fee and the treasury received exactly that.
USDT fee account `7y4zjYuiFw7eHDUYWByqMSmu3SebpzvvBJSQz8BVbmXL` created by you and
live 2026-09-15: USDT swaps pay inside the swap (from USDT received or sold, both
simulated first), not in SOL.

**26. Moon Rangers page, round two — shipped 2026-09-16.** Trait and rarity
explorer (all 219, filterable, each trait showing how many share it, rarity rank
from the usual sum of 1/frequency); recent sales from Magic Eden; holders over
time from snapshots the worker had been keeping for a year and never showing;
the minted/burned/named line; days staked and points earned on each of your own
Rangers. Two cached endpoints: `/api/collection` (6h) and `/api/collection/sales`
(10 min), both covered by `worker/test/collection.test.mjs`.

**A bug worth remembering:** a link straight to `#moon` restores that tab near the
top of the script, *before* `const POINTS_API` runs, so anything loading data
there threw "cannot access before initialization" — silently, inside a catch.
POINTS_API now sits at the top of the script. The browser test loads the page
fresh at `#moon` to keep it that way, and hash-only navigation in a test does not
reload the page, so it has to use a different URL.

**27. Bugs found by looking at the logs — fixed 2026-09-16.**
- The collection line said **1 minted · -218 burned**: Helius reports `total` as the
  size of the page it returned, so asking for one asset and reading it said the
  collection held one piece. It now counts whole pages.
- Two cleanup awards for the same signature at the same moment both got past the
  "already paid?" check and the second hit the primary key, returning a **500** to
  that person. Both awards now insert with ON CONFLICT DO NOTHING.
- Magic Eden refused the floor request **14 times in a week** (429). It is retried
  once before anything is logged.
- A refused swap quote logged only Jupiter's "Invalid input"; it now records the
  pair, size and slippage that were refused.
- The Ranger whose artwork was lost before the migration showed an empty square
  and a 502 in the console; its card now reads "art lost".

**28. Royalties to the Seeker — DONE 2026-09-17.** All 219 living Rangers now pay
`uPMPP…` 100%, rate still 3%, verified creator kept, update authority still 31jpe,
collection still verified, every metadata file loads. Two runs were needed: the
first sent eight transactions at once into an RPC plan that accepts one a second,
so only 15 landed (nothing failed on chain). `royalties.html` now paces sends,
retries refusals and reads the result back off the chain.

**29. The two blank names — DONE 2026-09-17.** Verified on chain: no blank names,
no duplicates, and all 219 metadata files load and agree with the chain.
`GVJWmz…` is **Ranger #236** (artwork recovered from its May 2024 file, Mech fur
and all), `oVPyKL…` is **Ranger #290**, and `FAtTsLTg…` keeps **Ranger #260**,
which it was minted as.

**The lesson worth keeping: identity comes from the mint transaction, not from
the Rarity Rank attribute.** The trait shop copies that rank onto swapped
Rangers — GVJWmz and FAtTsLTg both carry 956 — and naming from it briefly gave
the collection two "Ranger #260". The mint transaction names the IPFS file it was
minted from (`…/236.json`), which cannot be rewritten. royalties.html now refuses
any name another Ranger already holds.

*Cosmetic leftover: #236 still carries the copied "Rarity Rank 956" in its traits,
the same number #260 has. Harmless — the site's explorer computes rarity itself
and ignores that attribute.*

**30. Rarity Ranks corrected — DONE 2026-09-17.** Four Rangers carried a rank
belonging to another: #236 (956 → 817) and #290 (697 → 795) from the trait shop
copying it onto swapped pieces, #46 (835 → 263) and #205 (862 → 949) from the
September rename. Verified on chain: every Ranger now carries its own edition's
rank, no rank is shared by two Rangers, and all 219 metadata files load.

**Why this took four runs, worth remembering:** (1) eight parallel sends into a
1/s RPC limit, (2) a paste step that was easy to miss, (3) a check that read fresh
uploads from arweave.net, which 404s for hours while indexing, and (4) **a cached
copy of the signing page re-sent the previous run's update**. royalties.html is
now served `no-store` and prints its build under the title.

**31. Fee accounts, without the Jupiter dashboard — shipped 2026-09-17.** The
worker now derives the fee-account address Jupiter would use for any mint and
asks the chain whether it exists (cached a day), so creating one is all it takes
for swaps in that token to start earning. The derivation is ed25519 maths,
checked in CI against the four accounts Jupiter's own dashboard made.
`fees.html` creates them in bulk: the fifty busiest tokens on Solana, ticked
where missing, about 0.002 SOL of rent each, one transaction a second.

**Found while testing: eight popular tokens already had fee accounts** — ZEC,
cbBTC, STONK, HYPE, JUP, MET, xBTC and ANSEM — all under our referral account,
all at zero balance. They were invisible to the old hand-written list, and now
earn automatically.

**32. Points before signing in — nothing to fix (checked 2026-09-17).** A
signed-out visitor earns nothing, stores nothing, and the daily button reads
"Connect a wallet to claim". The old note predates the `/api/migrate` removal.

**21. Bot protection — shipped 2026-09-15, off by default.** With it on, the swap
gets a 0.000005 SOL tip added and is sent through Helius Sender with
`mev-protect`, so sandwich bots cannot trade around it. Proven by building a real
swap in the browser and simulating on mainnet: it costs the payer exactly the tip
and nothing else changes. Wallets that can only sign-and-send, or a swap too big
to take the extra instruction, go the normal way. ← Try one real swap with it on;
if it lands, consider making it the default.

---

## Soulbound collectible — live on mainnet 2026-09-20, mint still shut

```
collection     GHhygKTrAoPzdFABab4SRErtTcZVfrbhxtpNDWJHLJwW
candy machine  6wjQnzNY2yiRd2mFdkkjd8KzzHR31PRrdWmdpqi38rsH
candy guard    4XPdr5vnEMJAKzCuMUQBTsriuACEXxS6DtQ9zutCsEPA
setup wallet   U5M6butYfjeQxU4iZhCwMMysLxUFGWMCiFFymWuDNWu   (0.008 left)
```

`solquicks soulbound`, 0.1 SOL, one per wallet, 100,000 cap, frozen with no
thaw authority. Takings go to the Sanctum staking wallet
`FndhEjYMXMhihnoUfZbgm7mTWgCpcwoT3NikTABLV37m` — the only revenue that does
not go to the Seeker. Setup cost 0.0055; a buyer pays 0.1044 all in.

Verified by reading the chain rather than trusting the script: frozen true,
thaw authority None, 100,000 items, 0.1 SOL to the right address, one per
wallet, no bot tax.

**`MINT.live` is false.** The card is hidden and the mint answers only to
`?mint=preview`. What is left:

1. Mint #0 from the preview link and confirm it arrives — **waiting on this**
2. Flip `MINT.live = true` in index.html, deploy
3. Announce it
4. Years from now, withdraw the candy machine to reclaim ~0.0076 SOL

### What mainnet taught that a local validator could not

- **A confirmed transaction is not a visible account.** The candy machine's
  Initialize reads the collection, and reading one that has not propagated
  panics the program with `index out of bounds: the len is 0` — which is what
  a missing account looks like from inside it. The same gap then discarded a
  candy machine that *had* been created, by fetching it too early. Both steps
  now wait for the account to be readable, and both can be resumed with
  `--collection` / `--candy-machine` so a stumble never creates a duplicate.
  This also explains the devnet failures earlier blamed on a different program
  build — that diagnosis was wrong.
- **A bot tax turns a refusal into a successful transaction** that takes the
  tax and creates nothing. Removed.
- **Holding one and being paid for one are different facts**, and were the
  same database row. Points are claimed by their own update now.
- The funding check demanded 0.1 SOL, the figure from before anything had been
  measured. It costs 0.0096.

### Perks, as they now stand

| | Moon Ranger | Collectible |
|---|---|---|
| Swap fee | 50% off (10 bps) | 25% off (15 bps) |
| Book The Fox | 30% off | 5% off |
| Fox Points | 100/day staked | 250 once, on minting |
| Badge | 🦊 | 🚀 |

They do not stack: `perkTier` checks Rangers first and returns, so a wallet
holding both is charged the Ranger rate.

---

## Fee accounts — 2026-09-19 and 20

Every token ever swapped on this site now collects its fee in-token, plus the
76 busiest by market cap. Roughly 85 accounts created for about 0.13 SOL.

- **The rent is not recoverable.** `close_referral_token_account` is signed by
  the project admin, and the project is Jupiter's (`AfQ1oaud…`, read off the
  chain). The page said "recoverable later" for weeks; it now says the
  opposite.
- **Rent is 0.00149, not 0.00204.** The higher figure was assumed and wrong by
  a third, which mattered because it decides how many accounts a budget buys.
  Both figures are read from the chain now.
- **xStocks cannot have fee accounts at all.** They carry `ScaledUiAmount` and
  `Pausable`, two Token-2022 extensions the referral program predates, and it
  fails to deserialise the mint. Confirmed across issuers — OPENAI, DJT, MU,
  DKNG all fail the same way, so it is the extensions, not Backed. Only
  Jupiter can fix it. Those swaps still earn a SOL-side fee. A bug report is
  written up in conversation but not sent.
- The page ranks by volume, market cap, liquidity, organic score, holders or
  age, fills a rent budget by simulating each candidate first, and ticks only
  tokens swapped here or typed in by hand.

---

## Swap and site — 2026-09-19 and 20

- The token picker no longer throws the keyboard up on a phone.
- Amounts can be typed in dollars; defaults to the token every load.
- A slippage refusal now carries the fix as a button.
- The site installs to a home screen (manifest, icons at 192/512/maskable).
- Swap, Store and Book moved into the nav bar; the menu keeps the rest.
- **Fixed a leaderboard I broke:** `bind.apply(null, …)` gave D1 no statement,
  so every leaderboard with a row in it 500ed and the whole "Top swappers"
  box — Fox Points prizes and all — silently vanished. The test harness's
  `bind` was an arrow function, so `this` never mattered and it passed there.
  The harness now throws what real D1 throws.

---

## Next, once the above is unblocked

**Ranger referral rewards — built 2026-09-22, not deployed.** Design in
`docs/ranger-referrals-design.md`. Rangers earn 50% of the fee on wallets they
bring in, everyone else 20%; balances are claimed and paid by hand; the referee
earns 250 points after their first $50 swap. Nothing is ever paid for a signup,
only for fees generated, which is what makes it unfarmable without any identity
checks. Lives on the Fox Points tab as "Invite".

Before it goes live it needs the four invite tables applied to production D1
(`invite_codes`, `invites`, `invite_earnings`, `invite_claims` — all four are in
`worker/schema.sql`). Paying out is `GET /api/admin/invite/claims` to see what is
owed and `POST /api/admin/invite/paid` with the id and the USDC signature once
it has been sent.

---

## Blocked

**13. Referrals page has no referrals in it.**
Built 2026-09-22, ships hidden. `referrals.json` is an empty list and the tab
stays out of the menu until it is not. Each entry needs `name`, `url`, a logo
in `img/referrals/`, `what` the platform does and `youGet`. Waiting on the ten
links, logos and blurbs.

**12. ~~The consulting hour~~** — live 2026-09-22. Scheduled by hand rather
than through Calendly, whose free plan allows one event type and the 30-minute
link is using it. After paying, the form asks for a timezone and some times
that suit; you come back with one. Nothing recurring to pay for, and only
people who have actually paid ever get a slot.

If that becomes tedious, `npx wrangler secret put CONSULT_CALENDLY` with a
secret-event link makes the page hand that over instead — no code change, no
deploy. Cal.com's free tier allows unlimited event types if Calendly's does not.

**11. moon-stake mainnet.**
Needs ~1.8 SOL for program rent. Everything else is ready: 28 tests passing,
`stake-init.html` verified against the chain, `settle-stakers.mjs` dry-run
clean, runbook in `program/MAINNET.md`. Nothing expires — pick it up when the
SOL is there. Tony's review of `program/REVIEW.md` can happen meanwhile and
costs nothing.

---

## MoonPay onramp — planned 2026-09-20, not started

Buying crypto with a card or Apple Pay, so somebody with no SOL can still use
the site. Jupiter has no onramp to embed — their whole developer surface is
swap, trigger, recurring and prediction markets — and adopting their Plugin
would force Ultra's 50 bps floor against the 20 bps charged here. So it is
MoonPay or nothing.

It also answers "can we take Apple Pay for bookings": not directly, but a
customer can buy USDC with Apple Pay and pay the invoice with it. The
alternative, a card processor taking fiat straight to a bank, brings
chargebacks — someone can reverse a payment weeks after a Space has been
hosted, with nothing to dispute it with. Every payment here is final today
and that is worth keeping.

**Theirs, and the slow part — start these first:**

1. Create a partner account at dashboard.moonpay.com. Free since April 2026.
2. Complete business verification (KYB). Days, not minutes.
3. Hand over the publishable key (`pk_live_…`) — safe in the page by design.
4. Put the secret in the worker personally: `npx wrangler secret put MOONPAY_SECRET`.
5. Set the partner fee and allowlist solquicks.com in their dashboard.

**Mine, and none of it waits on the above:**

6. Build against the sandbox with test keys — a buy button on the swap, and a
   card path on bookings.
7. Sign widget URLs in the worker. Live mode requires it and signing needs the
   secret, so it cannot happen in the browser.
8. Prefill the connected wallet as the destination.
9. Handle the return, so the swap or booking carries on where it left off.
10. Widen `connect-src` for MoonPay's domain — small, but that policy is what
    stops the page talking to anywhere unexpected.
11. Tests: the sandbox flow end to end, and the signature against known values.

**Together:** their go-live review, then live keys, one small real purchase,
then announce. The hosted widget keeps most compliance obligations on their
side, which is why it beats building a quote screen here.

---

## Where this stands

The site earns on every swap, every token anyone trades here collects its fee
in-token, and the collectible exists on chain waiting for one test mint.

Open and blocked: **moon-stake mainnet** on ~1.8 SOL. Nothing about it expires.

Open and decided but unbuilt: **a MoonPay onramp** — Jupiter has none to
embed, and their Plugin would force a 50 bps floor against the 20 bps this
site charges, so it is MoonPay or nothing. No cost to onboard, approval
needed before going live.

Open and undecided: points earned before signing in still vanish when you
connect. The clean fix is to stop showing points to signed-out visitors so the
site never displays a number it will not honour.

Housekeeping: 58 dependency warnings, two critical, all in build tooling that
never reaches the browser.
