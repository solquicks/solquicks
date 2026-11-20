# Review of the unvetted agent commits — 2026-11-20

Four autonomous agents pushed 32 commits to `main` between 2026-10-25 and
2026-11-05, none reviewed (INFRA-12 in [infra-2026-11-20.md](infra-2026-11-20.md)).
This reviews the three that touch money or points.

**Verdict up front: all three hold up, and #13 is stronger than its own commit
message claims.** Nothing here needs fixing. Two things are worth knowing and
are recorded at the end; neither is a defect.

That is a genuine result rather than a rubber stamp, and it is worth saying why
the suspicion was reasonable: #17, by the same author, was wrong in two silent
ways. So each claim below was tested against the code rather than read off the
commit message, and the money paths were traced end to end.

| commit | claim | verdict |
|---|---|---|
| `48427ae` (#13) | USDC payments bound to reference, time, exact amount, all treasury accounts | **sound, exceeds the claim** |
| `00be3fa` (#11) | points exploit closed; game points bound to the session | **sound** |
| `f512c2d` (#16) | swap route options validated, stable error codes | **sound** |

---

## `48427ae` (#13) — the payment binding

Four claims, checked one at a time. All four live in `verifyInvoice`
(`worker/src/index.js:2959`), reached from `settlePayment` (`:3646`).

### 1. Reference — enforced

```js
if (inv.reference && p.keys.indexOf(inv.reference) < 0) {
  return { ok: false, error: 'that payment is not for this order' };
}
```

The Solana Pay reference must appear among the transaction's account keys.
`watchPayment` and `reconcilePayments` both find candidate signatures *by* that
reference, and loop over every candidate rather than taking the first — the
comment says why, and it is the right reason: *"a dust transfer carrying the
same reference must not hide the real one."*

### 2. Time — enforced

```js
if (inv.createdAt && p.blockTime !== null &&
    p.blockTime < inv.createdAt - INVOICE_CLOCK_SKEW_MS) {
  return { ok: false, error: 'that payment was made before this order existed' };
}
```

A payment that predates the order cannot settle it, with five minutes of clock
skew allowed. Units are right: `blockTime` is seconds from the RPC, multiplied
by 1000 in `inspectPayment`, compared against a `Date.now()` millisecond value.

### 3. Exact amount — enforced, and stricter than "exact"

```js
if (p.usdc !== minUsdc) { … }
```

Equality, not `>=`. Three distinct refusals follow it, and each is the right
one:

- paid in SOL → refused outright, because *"bookings are priced and settled in
  dollars"*
- **over**paid → refused **and** alerted, so the money is not quietly kept
- underpaid → refused

Refusing an overpayment is the unusual choice and the correct one. Silently
accepting it would mean keeping the difference.

### 4. All treasury accounts — enforced, and this is the subtle one

```js
if (r.mint === USDC_MINT && r.owner === treasury) {
  out[r.accountIndex] = Number(r.uiTokenAmount.amount || 0);
}
…
usdc += (post[k] || 0) - (pre[k] || 0);
```

Every USDC account the treasury owns, summed per account index across pre and
post balances. The code's own comment names the attack it closes: moving USDC
between two of the treasury's own accounts *"nets to zero instead of looking
like a payment."* Reading only the first matching row — the previous behaviour —
would have shown a credit. It also handles the account being created by the very
transaction being inspected, where the "before" row is absent and reads as zero.

And `treasury` comes from the booking row, never the request:

```js
// Reading it from the request instead would let somebody hold on one site
// and settle against another's treasury.
const treasury = await treasuryFor(env, b.site_slug);
```

### Beyond the claim

Three protections the commit message does not mention:

- **Replay, twice over.** A `SELECT` on `payments.signature` up front, then
  `INSERT … ON CONFLICT(signature) DO NOTHING` with `meta.changes === 0`
  treated as "already used". The comment is honest that the two are separate
  calls and that the primary key is what actually decides the race.
- **Double-settle.** The status update is conditional
  (`WHERE ref = ? AND (status = 'held' OR …)`) and only `meta.changes === 1`
  counts as paid. A second confirm changes nothing and says so.
- **Payer identity.** A payment from the treasury to itself is refused, and when
  a caller supplies a wallet the payer must match it.

### Why a skipped reference is still not exploitable

Both `inv.reference` and `inv.createdAt` are guarded by `if (inv.x && …)`, so a
caller passing neither skips both checks. I traced whether that is reachable and
whether it would matter:

- `reconcilePayments` selects `WHERE … reference IS NOT NULL`.
- `watchPayment` calls `findPaymentsByReference`, which returns `[]` without a
  reference, so nothing settles.
- The four direct routes (`:6056`, `:6351`, `:6387`, `:6659`) pass a real signed-in
  `payer`, so `p.payer !== wallet` refuses a stranger's payment.

Even granting a skipped reference, a payment would still have to go to the right
treasury, for the exact amount, after the order existed — and `payments.signature`
is a primary key, so any one payment can settle at most one order, ever. Not a
finding; recorded because the conditional looks like a gap and is not one.

---

## `00be3fa` (#11) — the points exploit

The exploit was in the game path: points could be credited to a wallet named in
the request. `worker/src/game/routes.js` was rewritten (541 lines) and the file
now opens by stating the rule it enforces:

> *everything that credits or reads a player's points needs a session, and the
> wallet is the session's, never one named in the request.*

Checked, not taken on trust.

**Player routes are session-derived.** `PLAYER_ROUTES` is an explicit list, and
everything on it passes through:

```js
const wallet = await h.getSession(request, env);
if (!wallet) return json({ error: 'not signed in' }, 401);
if (await h.rateLimited(request, env, path, wallet)) return h.tooMany(request, env);
```

**One route does read a wallet from the payload**, which looked like the rule
being broken. It is not: `/api/game/match/end` is the game server reporting who
played, and it is gated first:

```js
if (!serverAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
```

`serverAuthorized` is constant-time and **fails closed** — `if (!secret) return
false`, so an unset secret cannot be matched by an empty or missing header. That
was the single most important thing to confirm here, because a fail-open check
would have handed anyone the ability to mint points for any wallet.

**Replay cannot pay twice**, at three levels:

- `game_match_awards` is unique on `(match_id, wallet)` with `INSERT OR IGNORE`;
  anything but `changes === 1` is counted as a duplicate and skipped.
- The winning team is fixed by the first report — the upsert carries
  `WHERE game_match_records.ended_at IS NULL` — so a replay cannot re-declare a
  winner.
- `game_pending_points` is unique on `(wallet, source, source_id)`, so one match
  or one challenge period can only be queued once.

**Inputs are clamped**: `players` sliced to `MAX_PLAYERS_PER_MATCH`, kills and
deaths to `MAX_KILLS_PER_MATCH`, team and hero strings to 32 characters.

**And nothing is credited directly.** #13 put game points behind review: the
match queues `status = 'earned'` in `game_pending_points`, and `addPoints` runs
only in the admin decide path, with the holder boost applied there. So even a
flaw in the match report would produce a queue entry for a human to approve
rather than a balance change.

---

## `f512c2d` (#16) — the swap route options

Three new pass-through options. The risk is a caller forcing a route that costs
them, or zeroing the fee.

**Validation is strict and refuses rather than ignores:**

```js
const b = parseBoolParam(params.get(name));
if (b === undefined) return { error: name + ' must be true or false' };
…
const n = /^[0-9]{1,3}$/.test(raw) ? Number(raw) : NaN;
if (!(n >= MAX_ACCOUNTS_MIN && n <= MAX_ACCOUNTS_MAX)) { … }
```

Booleans must be exactly `true/1/false/0`; `maxAccounts` must be a whole number
in 16–64, bounded because *"much below 16 nothing routes at all — a smaller
number is a typo, not a choice."* Malformed input is a 400 `BAD_OPTION`, never
silently dropped. Absent means the option is not sent at all, so existing quotes
are byte-for-byte what they were.

**The fee is not caller-controllable.** `platformFeeBps` comes from
`swapFeeBpsFor(holder)`, derived server-side from the wallet's tier. There is no
`params.get` for it anywhere.

The three exposed options only change the shape of the route, not the value
guarantee — Jupiter still enforces the slippage limit on chain — and they affect
only the caller's own swap.

---

## Two things worth knowing

Neither is a defect, and neither belongs to these three commits.

**1. The swap API accepts up to 50% slippage.** `slippageParam` is
caller-supplied and clamped to `[1, 5000]` bps, defaulting to 50 (0.5%) and
`auto` in the page. On a slippage failure the page escalates it a step at a time
and tells the user. 5000 bps is a lot to permit — it is half the trade — and
while it is the user's own money and their own signature, it is the sharpest
edge in the swap path. Pre-existing, not introduced by #16. Worth a deliberate
decision about the ceiling rather than leaving it at the maximum Jupiter allows.

**2. `SERVER_TO_WORKER_SECRET` is not in `REQUIRED_SETTINGS`.** The five
declared there are `HELIUS_API_KEY`, `JUPITER_API_KEY`, `ADMIN_TOKEN`,
`TREASURY_WALLET`, `ALLOWED_ORIGINS`. If the game secret is unset nothing warns,
and `/api/game/match/end` answers 401 forever — so matches silently stop earning
points. It fails **safe**, not open, so this is an availability and
observability gap rather than a security one. Adding it to that list would make
the failure loud.

## Method, and its limits

Each claim was checked against the code path rather than the commit message, and
for the payment flow I followed it from the route through `settlePayment` into
`verifyInvoice` and `inspectPayment`. What I did **not** do is execute a payment
or a match against a live environment — everything above is read from source and
from the existing tests, so it establishes that the guards are present and
correctly shaped, not that they behave correctly against the real chain.

The tests that accompany these commits do assert the new guarantees rather than
only the happy path — `worker/test/booking-api.test.mjs` covers the no-link and
no-config branches, and `worker/test/game.test.mjs` (460 lines, added by #11)
covers the match and claim routes. That was the specific thing I expected to
find missing, and it was not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
