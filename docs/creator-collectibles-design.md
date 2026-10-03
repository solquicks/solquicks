# Creator-minted collectibles — design, not yet built

An addition to the **Store** feature, offered to creators who want it: their own
soulbound collectible, minted by their audience from their own site, with 1% of
every transaction coming back to this platform.

Written down now because the hard part is not the minting — that code already
exists and runs on mainnet for this site's own collectible. The hard part is the
1%, and the reason is structural rather than fiddly. Better to know that before
the build starts than halfway through it.

**Not scheduled.** Goes live after the hackathon, with funding. Nothing in this
file is wired up.

## What already exists and can be reused

| Piece | Where | State |
|---|---|---|
| Soulbound mint, Metaplex Core | `collectible/` | live on mainnet for this site; mint shut |
| Per-site treasury routing | `treasuryFor()` in `worker/src/index.js` | live |
| Payment verification | `verifyInvoice()` | live |
| `collectibles` table | `worker/schema.sql` | live, one row per wallet |
| A 1% platform share | `LAUNCH_PLATFORM_PCT` | live, but see below — it is not this |

## The problem: there is no mechanism to take 1% of anything

`LAUNCH_PLATFORM_PCT = 1` is **not** a cut of transactions. It is a share of the
token a creator launches — one line in a three-way split written into the `sites`
row at launch. It has never moved a dollar.

Every payment a creator's site takes goes **100% to the creator**. That is not an
oversight, it is what the code enforces:

```js
// verifyInvoice()
const payTo = treasury || env.TREASURY_WALLET;   // the creator's wallet
if (!(p.usdc >= minUsdc)) { /* refuse */ }       // the full amount, to that one wallet
```

One wallet, the whole amount. A payment that split 99/1 between the creator and
this platform would be **refused as underpaid**, because the creator's wallet
received less than the invoice. So "collect 1% on every transaction" cannot be
switched on with a constant. It needs one of the three designs below.

## Three ways to take the 1%, and which to pick

### 1. Split transfer — two instructions, one transaction (recommended)

The page builds a transaction with two USDC transfers: 99% to the creator, 1% to
the platform. Both land or neither does.

- Settles atomically. There is no window where the creator is paid and the
  platform is not.
- Nothing to chase, reconcile or invoice.
- Costs: `verifyInvoice` has to learn about a second recipient, which is a real
  change to the function every paid route on the site depends on. It would need
  a `platformCut` argument and a test for every existing caller proving the
  single-recipient behaviour is untouched.
- The QR path needs thought: a Solana Pay URL carries one recipient. Either the
  QR drops to platform-collected-later, or QR is not offered for these.

### 2. Mint fee held back at the source

The collectible mint is a separate transaction from any store payment, so charge
the 1% there — the audience pays the creator for the item, and pays a small
platform fee to mint the collectible that proves it.

- No change to `verifyInvoice` at all.
- Reads honestly to the buyer: a mint fee is a mint fee.
- But it is 1% of *mints*, not 1% of *transactions*, which is not what was asked
  for. Only worth it if the collectible is the product rather than a receipt.

### 3. Invoiced monthly against recorded volume

Record every settled payment per site, total it, bill the creator.

- Zero change to the payment path.
- Worst option: it turns a platform fee into a receivable, and chasing creators
  for 1% of a $40 plushie is not a business.

**Recommendation: (1), with (2) as the fallback if the QR path proves awkward.**

## What to build, in order

1. `platformCutFor(env, siteSlug)` — basis points, `0` for this site's own pages.
   A creator's own site should never be charged on this site's behalf by
   accident, so the default has to be no cut rather than some cut.
2. Teach `verifyInvoice` a second recipient. **Do this first and alone**, with
   tests proving every existing route still demands the full amount to one
   wallet. This is the only genuinely risky change in the list — it touches
   bookings, bundles, the ad slot, the store and the basket.
3. A `creator_collectibles` table: site slug, collection address, supply, price,
   whether minting is open.
4. Extend `collectibles` with the site it belongs to. Today it is keyed on
   `wallet` alone, so one wallet can hold exactly one collectible across the
   whole platform — which breaks the moment a second site offers one.
5. Mint from the creator's own Core collection, with the creator as update
   authority. The platform must not be able to change a creator's collection.
6. A Store toggle in the creator's own settings, off by default.
7. The 1% itself, last, once everything above is proven.

## Decisions to make before building

- **Who pays the mint's network fee?** The audience, the creator, or the
  platform. It is cents, but somebody's wallet needs the SOL in it.
- **Who is the update authority?** It should be the creator. That means the
  platform cannot fix a broken collection for them, which has to be said out
  loud in the creator's settings rather than discovered later.
- **Is the 1% disclosed to the creator's audience?** This site states its own
  fees plainly on `fees.html`. A creator's site taking an undisclosed platform
  cut would be the one dishonest thing on an otherwise honest stack.
- **What happens to a live collection if a site is taken down?** The collectible
  is in somebody's wallet and outlives the site. It cannot stop existing because
  a subscription lapsed.

## The thing most likely to go wrong

Step 2. `verifyInvoice` is the function that decides whether somebody has paid,
and it is shared by every paid route on the platform. A change there that is
slightly wrong does not fail loudly — it either accepts underpayments or refuses
real ones, and both are discovered by a customer rather than by a test. It gets
its own branch, its own review, and `test/verify-invoice.test.mjs` extended
before a single line of collectible code is written.
