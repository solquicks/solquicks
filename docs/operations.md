# Running the site

## Health

```bash
curl https://solquicks-points.solquicks-45c.workers.dev/api/health
```

Reports the database, Helius, and how many errors were logged in the last
hour. A scheduled check runs every 30 minutes and records the result.

## Alerts (optional, ~2 minutes to enable)

Alerts fire only when health *changes* — so an outage pings once, not every
half hour, and you also get told when it recovers. Without the secrets below
everything still records silently.

1. Message `@BotFather` on Telegram, `/newbot`, copy the token.
2. Message your new bot once, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the `chat.id`.
3. From `worker/`:

```bash
npx wrangler secret put TELEGRAM_ALERT_TOKEN
npx wrangler secret put TELEGRAM_ALERT_CHAT
```

## Backups

Cloudflare keeps 30 days of point-in-time recovery on the database, so this is
about holding a copy *outside* the account.

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://solquicks-points.solquicks-45c.workers.dev/api/admin/export \
  -o points-backup-$(date +%F).json
```

The admin token is a Cloudflare secret. Rotate it with
`npx wrangler secret put ADMIN_TOKEN` from `worker/`.

There is also `npx wrangler d1 export solquicks-points --remote --output=dump.sql`
for a full SQL dump.

## Rate limits

Sized around Helius's free tier, which allows only 2 NFT lookups per second —
that is the resource abuse would actually cost money on.

| Routes | Limit | Keyed by |
|---|---|---|
| sign-in | 10/min | IP |
| chain reads (rangers, stake, images) | 20/min | wallet |
| writes (visit, award, claim, unstake) | 30/min | wallet |
| coin flip | 30/min | wallet |
| public reads | 60/min | IP |

Counted in the database rather than with Cloudflare's rate-limit binding —
that binding does not enforce on this plan and silently allows everything.

## Coin flip

Points only. No money in, no money out. The outcome is decided server-side
with cryptographic randomness and rejection sampling, so heads and tails stay
exactly even. The wager is deducted *before* the flip, so a dropped connection
can never mean a free win. Min 10, max 1000 per flip.

```bash
# how the coin has actually landed
curl -H "Authorization: Bearer <session>" \
  https://solquicks-points.solquicks-45c.workers.dev/api/flip/stats
```
