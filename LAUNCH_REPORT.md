# Moon Rangers FPS — Launch Report

Branch: `game-launch-integration`  
Date: 2026-10-15  
Commit: fa613bf

---

## What was done

### Phase 1 — Site integration

| Change | File | Status |
|---|---|---|
| Game build copied to `/games/moon-rangers/` | `games/moon-rangers/` | ✅ Done |
| Meta tags (OG, Twitter card, canonical) added to game page | `games/moon-rangers/index.html` | ✅ Done |
| Games hub page created | `games/index.html` | ✅ Done |
| SPA rewrite added (game sub-routes → index.html) | `vercel.json` | ✅ Done |
| "Play the game SOON" card → live link | `index.html` line ~2828 | ✅ Done |

### Phase 2 — Worker game API

| Change | File | Status |
|---|---|---|
| Game route handler created | `worker/src/game/routes.js` | ✅ Done |
| Wired into Worker fetch handler | `worker/src/index.js` | ✅ Done |
| Removed empty GAME_DB binding | `worker/wrangler.toml` | ✅ Done |
| Game tables use `game_` prefix in production DB | additive only | ✅ Safe |

### Game API routes added
- `GET /api/game/points` — player FP balance + game stats (requires session token)
- `GET /api/game/leaderboard` — top 25 by kills (public)
- `POST /api/game/match/start` — register a match (requires SERVER_TO_WORKER_SECRET)
- `POST /api/game/match/end` — award FP: 10/kill + 50 win bonus (requires SERVER_TO_WORKER_SECRET)

---

## QA checklist

- [x] Asset paths correct: `/games/moon-rangers/assets/index-jhzzYymG.js`
- [x] SPA rewrite: `/games/moon-rangers/(.*)` → `/games/moon-rangers/index.html`
- [x] OG + Twitter card meta tags present
- [x] Canonical URL set
- [x] SOON card removed, live link added with hover style
- [x] Game routes file has constant-time secret comparison
- [x] All DB writes parameterized, no string interpolation
- [x] Schema uses `IF NOT EXISTS` — additive, idempotent
- [x] Kill count capped at 100/match to prevent runaway FP awards
- [x] wrangler.toml has no empty database_id that would break deploy

---

## Before you go live — required steps

### 1. Set the game server secret (one-time)

The Worker's `/api/game/match/start` and `/api/game/match/end` routes are
protected by `SERVER_TO_WORKER_SECRET`. Set it now:

```bash
cd /Users/solquicks/Developer/solquicks.com/worker
npx wrangler login          # if not already logged in
npx wrangler secret put SERVER_TO_WORKER_SECRET
# (type or paste a long random string when prompted)
```

The same secret goes into the game server's `.env` as
`SERVER_TO_WORKER_SECRET=<same value>`.

### 2. Deploy the Worker

```bash
cd /Users/solquicks/Developer/solquicks.com/worker
npx wrangler deploy
```

This deploys the game API routes. Zero existing routes are changed.

### 3. Deploy the site (Vercel preview)

The Vercel CLI wasn't authenticated during this session. Deploy manually:

```bash
cd /Users/solquicks/Developer/solquicks.com
! vercel login              # type this in Claude Code prompt
! vercel deploy             # preview deploy — NOT production
```

Or push the branch to GitHub and let Vercel auto-create a preview deployment.

Preview URL format: `https://solquicks-git-game-launch-integration-<team>.vercel.app`

### 4. Smoke test the preview

Open the preview URL and check:
- `/games/` — games hub loads, Moon Rangers card visible
- `/games/moon-rangers/` — game loads, role select screen appears
- `/games/moon-rangers/anything` — still loads the game (SPA rewrite)
- Home page — "Play Moon Rangers FPS" card links correctly

### 5. Take a live database backup before promoting to production

```bash
cd /Users/solquicks/Developer/solquicks.com/worker
npx wrangler login
npx wrangler d1 export solquicks-points --remote --output=/Users/solquicks/Desktop/solquicks-points-backup-LIVE.sql
```

### 6. Promote to production

After the smoke test passes:

```bash
! vercel promote <preview-deployment-url>
```

Or use the Vercel dashboard → Deployments → click the preview → "Promote to Production".

---

## Rollback

See `ROLLBACK.md` in this repo for full step-by-step instructions.
