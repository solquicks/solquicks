# Issuing plushie codes

Plushie points used to be granted by the Buy Now click, which meant 500 Fox
Points for opening a tab and buying nothing. Points now come from a code that
you issue against a real order, redeemable exactly once.

store.fun has no order webhook we can consume, so the verification step is you
reading your own orders. That is the whole security model: a code exists only
because you saw an order.

## Issue codes

Codes are generated server-side rather than derived from the order number, so
knowing someone's order number is not enough to claim their points.

```bash
curl -s -X POST https://solquicks-points.solquicks-45c.workers.dev/api/admin/plushie/codes \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"count": 5, "note": "orders 2026-09-09"}'
```

Returns codes shaped `FOX-XXXXX-XXXXX`. `count` is capped at 50 per call. The
`note` is for your own reference — put the order number or the date in it so you
can reconcile later.

Send one code per order to the buyer, however you already talk to them: the
store.fun order message, Discord DM, or a card in the parcel.

## See what has been redeemed

```bash
curl -s https://solquicks-points.solquicks-45c.workers.dev/api/admin/plushie/codes \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -m json.tool
```

Shows the 200 most recent codes with `redeemed_by` and `redeemed_at`. An unused
code has both as `null`.

`ADMIN_TOKEN` is a Cloudflare secret on the `solquicks-points` worker. Don't
paste it into a chat, a commit, or the site — it is the same token that settles
missions and approves banner bookings.

## What the buyer does

On the Store tab, under Buy Now: connect wallet, enter the code, redeem. Case
doesn't matter. The code is burned on first use — a second attempt, by them or
anyone else, gets the same "not valid, or already used" message. That message is
deliberately identical for unknown and used codes, so nobody can probe for valid
ones.

## If someone loses their code

Check the list above to confirm it wasn't already redeemed, then issue a new one
and tell them to use that. There is no way to un-redeem a code, and no way for a
buyer to redeem twice — which is the point.

## Worth knowing

- The award is 500 points, set by `AWARDS.plushie` in `worker/src/index.js`.
- `/api/award` no longer accepts `type: "plushie"` at all; it returns
  `unknown award`. That is intentional — leave it that way.
- Redeeming is rate-limited to 10 attempts per IP per minute. Guessing a code is
  infeasible regardless (32^10 combinations); the limit just stops anyone
  hammering the endpoint.
