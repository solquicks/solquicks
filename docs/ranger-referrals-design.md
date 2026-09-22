# Ranger referral rewards — design, not yet built

A Ranger shares a link. Someone arrives, connects a wallet, and that wallet is
tied to the Ranger for good. From then on, every swap the referred wallet makes
on this site earns the Ranger points and a share of the fee.

Nothing here is live. This is the thing to argue with before any of it is built.

## Where the numbers actually are

Read from production on 2026-09-22:

| | |
|---|---|
| Swaps, ever | 45 |
| Wallets that have swapped | 3 |
| Volume, ever | $3,417 |
| Fees collected, ever | $4.61 |
| Wallets holding a Ranger | 132 |
| Wallets that have ever signed in | 3 |

This changes what the system is for. 132 people hold a Ranger and three have ever
arrived. The constraint is not how to divide revenue — there is almost none to
divide — it is that nearly nobody has shown up. So the referral system is an
acquisition tool that happens to pay out, not a revenue-sharing scheme.

Two consequences:

- **Points are the live incentive.** They can be paid today, in full, and they
  already feed missions and the leaderboard.
- **The revenue share should accrue from the first swap and be claimable when it
  is worth claiming.** At current volume a 20% share across all referrers would
  be about 92 cents in total, ever. A dashboard that shows $0.00 and says why is
  honest. One that implies real money is coming is not.

## The rule that makes the whole thing safe

**Pay on fees generated, never on signups.**

A signup bounty is free money for anyone with a script: a hundred fresh wallets,
one code, done. A share of fees paid inverts that. To be paid $2, somebody has to
hand over $10 in fees. Wash trading through your own code is a losing trade at
every share below 100%:

| Share to referrer | Fee paid on a $10k round trip | Referrer receives | Net |
|---|---|---|---|
| 10% | $40 | $4 | −$36 |
| 20% | $40 | $8 | −$32 |
| 30% | $40 | $12 | −$28 |

That one rule removes most of the abuse surface. No KYC, no captcha, no manual
review, no sybil detection — the economics do the work. It is the reason the
reward must never be paid for connecting, only for trading.

## Mechanics

1. **The code.** Generated per wallet, readable and hard to mistype: `FOX-7QK2`,
   from the same alphabet as booking references (no O/0, no I/1). Vanity codes
   are nicer to share but need a uniqueness check and a blocklist — somebody will
   try to register a code that impersonates a project. Worth doing later, not in
   the first version.

2. **The link.** `solquicks.com/?r=FOX-7QK2` stores the code in the browser, plus
   a box to type one in by hand. Neither does anything until a wallet connects.

3. **Binding.** First touch wins. One referrer per wallet, permanent. Refused if
   the code is the wallet's own, and refused if the wallet has already swapped
   here — otherwise the first thing that happens is existing users being claimed
   by whoever DMs them first, which pays out on volume that was already coming.

4. **Earning.** On each swap recorded against a referred wallet:
   - the referrer accrues N% of the fee this site actually collected, in USD
   - the referrer earns a share of the points the referee earned, minted fresh
     rather than taken out of the referee's award

5. **Paying.** The USD balance accrues as a database number. It is claimed, not
   airdropped — the same pattern as missions. Below a floor it is not claimable,
   because a $0.30 USDC transfer costs more in attention than it is worth.

## What this does not do

- It does not touch the Jupiter fee accounts or how they are claimed. Those stay
  exactly as they are. The share is computed from the `swaps` table, which already
  records `usd`, `fee_bps` and `fee_amount` for every swap made here.
- It does not pay in the mint the fee was collected in. Fees arrive across 85+
  token accounts; splitting each one per referrer would be dust across dust.
  Accrue in USD, settle in one currency.
- It does not change what anyone pays. The referee's fee is unchanged — the share
  comes out of this site's cut, not out of their pocket.

## Naming

The Referrals tab built on 2026-09-20 is the outbound one: platforms solquicks
uses, and what a visitor gets for joining through those links. This is the
inbound one and pointing both at the word "referral" will confuse both. Suggest
this one is called **Invite** — "your invite link", "who you invited" — and lives
on the Fox Points tab where the rest of a wallet's earnings already are.

## Decided, 2026-09-22

**The share: a Ranger earns 50% of the fee, everyone else 20%.**

Two answers set opposite ends of the same dial — 50% for Rangers, and everyone
allowed to refer with Rangers earning more. This is both: anyone can share a
link, and holding a Ranger more than doubles what it pays. The rate is read at
the moment of the swap, the same way the fee tier is, so selling the Ranger drops
the rate from then on and does not claw back what was already earned.

50% still cannot be farmed. A round trip costing $40 in fees returns $20 — losing
$20 to move money between your own wallets. The rule holds at this rate; it would
stop holding at 100%.

Collectible holders sit at 20% with everyone else for now. There is a case for
slotting them at 30%, since the tier machinery already knows the difference, but
three rates are harder to explain than two and the collectible already carries
four perks.

**The payout: claimed, signed by hand.**

The balance accrues as a number. Above $10 it can be claimed, which queues it;
payment goes out as USDC in batches, signed by you. No signing key goes into the
worker, so a break-in there reaches a database of numbers rather than a funded
wallet. At the volume in the table above, the first batch is a long way off —
which is the honest reason not to build the automated version yet.

**Who refers: everyone, at the two rates above.**

**The referee gets 250 points after their first swap of $50 or more.**

Not on connect. A bonus for arriving is a bounty a script can collect a hundred
times over; a bonus for trading costs more to farm than it pays. It gives the
person sharing the link something concrete to say, and it pays nothing at all to
a wallet that connects and leaves.

## Still open

- **How long a referral pays for.** Lifetime is simpler and the better offer. A
  12-month window is what most exchanges do, and caps the tail. Suggest lifetime
  until there is a reason not to.
- **Whether to cap what one referee can generate in a month.** Nothing today
  comes close to needing it, but an unbounded number is the kind of thing worth
  bounding before it matters rather than after.
- **Vanity codes.** Wanted eventually. Needs a uniqueness check and a blocklist,
  because somebody will try to register a code that impersonates a project.
