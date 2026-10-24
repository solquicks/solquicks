# The Fox Dollar — drafted, switched off

Our own branded dollar, built on [Reflect Create](https://docs.reflect.money/products/create.md):
a token backed by collateral Reflect has reviewed, which appreciates because
the collateral earns, and whose interest splits between us and the people
holding it.

**It is not launched, and the switch is off.** Everything below exists so the
shape and the wording can be argued with before anything irreversible happens.

## Why it is off

Not caution in general — one specific fact.

The collateral this would sit on has not visibly earned anything. Between
2 and 24 October 2026 the Worker took **1,043 readings** of the USDC+
redemption rate and every single one came back `1.008428`:

```sql
SELECT COUNT(*), MIN(rate), MAX(rate) FROM savings_rate;
-- 1043 | 1.008428 | 1.008428
```

At any real yield that should have crept to roughly `1.00873` over that span.
It is why `/api/reflect/apy` answers "no yield data found" and why the Savings
tab says *"No rate published yet"* — `derivedSavingsApy()` refuses to compound
a flat line into a number, which is the right call.

Reflect's own documentation puts the consequence squarely on us:

> *"You face your users. Reflect custodies nothing, but your name is on the
> token, so disclosure of what backs it sits with you."*

> *"Yield is not fixed. Promise them a number and you absorb the difference."*

Issuing a coin with our name on it, on top of collateral we cannot show is
working, is the wrong way round. **Settle the rate question first.** It is
either a reporting artefact in Reflect's quote endpoint or the yield genuinely
is not flowing, and those are very different situations.

## What it would be

| | |
|---|---|
| Symbol | `FOXD` |
| Name | Fox Dollar |
| Our share of the interest | **10%** |
| Holders keep | **90%** |

Reflect's own illustration keeps a fifth. This keeps half that, because the
point of a branded dollar here is that holding it should beat holding USDC. At
their worked example — collateral earning 5% — holders would see 4.5% and our
share works out around **$50,000 a year per $10M outstanding**.

The split is written once, in `YIELDCOIN.ourShareBps`. The holder share, the
API response and the disclosure all derive from it, so they cannot drift apart
the way the first bundle rate card did.

## What a holder is told

Served from `/api/yieldcoin` so there is one wording to keep honest rather than
several scattered through a page. It leads with what it is **not**:

- A Fox Dollar is not a deposit, not a bank account and not insured.
- The yield is not fixed and is not promised. It can fall to nothing.
- We take 10% of the interest; you keep 90%. Nothing is taken from your balance.
- Your money is never held by us — deposits sit in the contracts, every
  movement is signed by you, and redemption runs against the contracts directly.
- If the collateral loses value, so does this.

`test/yieldcoin.test.mjs` asserts each of those lines is present. Removing them
fails the build, which is deliberate: this is the easiest copy on the site to
quietly soften.

## The three locks

Launching creates a mint that **cannot be unmade**, so it takes all three:

1. **The flag.** `YIELDCOIN = "on"` in `wrangler.toml` and a deploy. A branch
   cannot drift into production; somebody has to mean it.
2. **The admin token.** `/api/yieldcoin/launch` and `/upload` both require it.
3. **An explicit confirmation.** The request body must carry `confirm: "FOXD"`.

Each is tested by removing it: the flag fails 2 assertions, the admin check 5,
the confirmation 4.

## Turning it on, when the time comes

1. Get an answer on the flat rate. Nothing else matters until then.
2. Take legal advice. Reflect builds around the CLARITY Act's control-based
   framework and argues we are not custodian, manager or issuer — their keys
   hold nothing, we hold no reserves, venue selection follows a published
   methodology. Their docs also say plainly that **none of it is legal advice.**
   "Is my company issuing a dollar-denominated instrument" is a question for a
   lawyer.
3. Decide whether the first coin is ours or a creator's. It should be ours:
   carry the risk before asking anybody else to.
4. Write the public disclosure page from the strings in `yieldcoinDisclosure()`.
5. `POST /api/yieldcoin/upload` with the image and metadata, then
   `POST /api/yieldcoin/launch` with the URLs it returns and the confirmation.

## What is not built

- No mint, redeem or claim path. Those are `/api/yieldcoin/*` additions and
  should be written against the Whitelabel SDK once the coin exists.
- No UI. Deliberately — there is nothing to show until there is a coin, and a
  page advertising a yield we cannot demonstrate is the thing to avoid.
- No collateral choice. `initialize/flow` is called with Reflect's default set;
  picking a basket is a decision to make with the rate answer in hand.
