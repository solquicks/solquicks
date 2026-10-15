# Game Integration — Rollback Steps

If something goes wrong after going live, here is how to undo everything.
No developer experience needed — follow these steps in order.

---

## Step 1 — Revert the site (takes 2 minutes)

**Option A — via Vercel dashboard (easiest):**
1. Go to vercel.com → your solquicks.com project → Deployments
2. Find the last deployment that was working before this integration
3. Click the three-dot menu next to it → "Promote to Production"

**Option B — via terminal:**
```bash
cd /Users/solquicks/Developer/solquicks.com
git revert HEAD   # or: git checkout main
npx vercel deploy --prod
```

---

## Step 2 — Revert the Worker

```bash
cd /Users/solquicks/Developer/solquicks.com/worker
git checkout main -- src/
npx wrangler deploy
```

---

## Step 3 — Restore the database (only if data is corrupted)

⚠️ Only do this if player data was actually damaged. This will overwrite any
Fox Points earned after the backup was taken.

**Local backup** (dev only, not production):
```bash
npx wrangler d1 execute solquicks-points --file=/Users/solquicks/Desktop/solquicks-points-backup-20261015.sql
```

**Production backup** — you must export this manually before going live:
```bash
cd /Users/solquicks/Developer/solquicks.com/worker
npx wrangler login   # refresh token first
npx wrangler d1 export solquicks-points --remote --output=/Users/solquicks/Desktop/solquicks-points-backup-LIVE.sql
# Then restore with:
npx wrangler d1 execute solquicks-points --remote --file=/Users/solquicks/Desktop/solquicks-points-backup-LIVE.sql
```

---

## What this integration changed

| Area | Change | Safe to revert? |
|---|---|---|
| Site | Added /games/ and /games/moon-rangers/ pages | Yes — delete the folders |
| Site | Updated Fox Points "Play the game" card to live link | Yes — edit index.html line 332 |
| Site | Added game rewrite to vercel.json | Yes — remove the added rewrite |
| Worker | Added game routes (import + handler call) | Yes — remove those 3 lines |
| Database | Added 5 new game_ tables (additive only) | Tables can be left — they are empty |

**No existing data was deleted or modified.**

---

## Note on the remote database backup

The automated remote backup failed during integration setup (Wrangler OAuth token
was missing the k2.read/k2.write scopes). Before going live, run:

```bash
cd /Users/solquicks/Developer/solquicks.com/worker
npx wrangler login
npx wrangler d1 export solquicks-points --remote --output=/Users/solquicks/Desktop/solquicks-points-backup-LIVE-$(date +%Y%m%d).sql
```

Keep that file on your Desktop before you promote to production.
