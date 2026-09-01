# solquicks workers

Two Cloudflare Workers back solquicks.com. Both are deployed with
`npx wrangler deploy` from their own directory.

## solquicks-points (this folder)
Fox Points API — points, staking and the leaderboard.
`https://solquicks-points.solquicks-45c.workers.dev`

Points live in D1 (`solquicks-points`), keyed by wallet address, so a balance
cannot be edited in the browser and follows the player across devices.

Sign-in is Sign-In-With-Solana: the client asks for a nonce, the wallet signs a
message containing it, and the worker verifies the Ed25519 signature against the
wallet address before issuing a 30-day session token. Every award amount is
decided here, never sent by the client.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/leaderboard` | GET | public | top 100 by points |
| `/api/nonce` | POST | public | start sign-in |
| `/api/session` | POST | public | exchange signature for a token |
| `/api/me` | GET | bearer | balance, history, stake |
| `/api/visit` | POST | bearer | daily +5, once per day |
| `/api/stake` | POST | bearer | verifies Rangers via Helius, then stakes |
| `/api/unstake` | POST | bearer | banks accrued points |
| `/api/claim` | POST | bearer | pays out accrued staking points |
| `/api/award` | POST | bearer | plushie / game / gacha |
| `/api/migrate` | POST | bearer | one-time import of anonymous points |

Staking pays 100 points per day per Ranger. Changing holdings banks earnings at
the old count before continuing at the new one, so buying never inflates past
earnings and a sold Ranger stops earning.

Secret: `HELIUS_API_KEY`. Schema: `schema.sql`.

## solquicks-rpc-proxy
Read-only Solana RPC proxy from `helius-labs/helius-rpc-proxy`, so the browser
can check NFT ownership without the Helius key ever being public.
`https://solquicks-rpc-proxy.solquicks-45c.workers.dev`

> A Helius **domain restriction breaks both workers** — they call Helius
> server-to-server with no browser Origin and get a 403. Leave it off.
