-- Step 5 (security fixes, 2026-10-29). NOT APPLIED. Run once, before the
-- worker build 'security-2026-10-29' is deployed:
--
--   cd worker && npx wrangler d1 execute solquicks-points --remote --yes --file migrations/005-one-stake-per-ranger-and-pending-game-points.sql
--
-- Take a backup first (wrangler d1 export solquicks-points --remote --output backup-005.sql).
--
-- NOT safe to run twice: the ALTER TABLE below fails the second time with
-- "duplicate column name: verified_at". Everything else is idempotent, so if
-- it fails only on that line the rest can be run on its own.

-- ── 1. One active stake per Ranger ──────────────────────────────────────────
-- staked_nfts was keyed on (wallet, mint), so one Ranger sold or moved to a
-- second wallet could be staked by both and earn twice. Before the unique
-- index can exist, every mint has to be down to one row.
--
-- Bank what the affected wallets had earned up to now, at their current count,
-- so nobody loses points already accrued by the recount below. Same formula as
-- stakeAccrued() in src/index.js: 100 points per Ranger per day.
UPDATE stakes
SET banked = banked + CAST(((unixepoch() * 1000 - since) / 86400000.0) * 100 * count AS INTEGER),
    since  = unixepoch() * 1000
WHERE staked = 1 AND since > 0 AND count > 0
  AND wallet IN (
    SELECT wallet FROM staked_nfts WHERE mint IN (
      SELECT mint FROM staked_nfts GROUP BY mint HAVING COUNT(*) > 1));

-- Keep the most recent stake of each Ranger (the latest wallet to prove it
-- held it); drop the older ones. The next ownership check moves it back if
-- that guess is wrong.
DELETE FROM staked_nfts
WHERE rowid NOT IN (
  SELECT rowid FROM (
    SELECT rowid, ROW_NUMBER() OVER (PARTITION BY mint ORDER BY since DESC, rowid ASC) AS n
    FROM staked_nfts) WHERE n = 1);

CREATE UNIQUE INDEX IF NOT EXISTS staked_nfts_mint ON staked_nfts(mint);

-- When the worker last saw this Ranger in this wallet on-chain. Holder perks
-- only count a stake checked in the last 24 hours; NULL counts as unchecked.
ALTER TABLE staked_nfts ADD COLUMN verified_at INTEGER;

-- Make every wallet's count match the rows it actually has now.
UPDATE stakes
SET count  = (SELECT COUNT(*) FROM staked_nfts s WHERE s.wallet = stakes.wallet),
    staked = CASE WHEN (SELECT COUNT(*) FROM staked_nfts s WHERE s.wallet = stakes.wallet) > 0 THEN 1 ELSE 0 END,
    since  = CASE WHEN (SELECT COUNT(*) FROM staked_nfts s WHERE s.wallet = stakes.wallet) > 0 THEN since ELSE 0 END;

-- ── 2. Game points wait for review ──────────────────────────────────────────
-- Matches, challenges and the share bonus used to credit Fox Points straight
-- away. They now land here as 'earned'; the player claims them on the Fox
-- Points dashboard ('claimed'), and the admin approves ('approved', credited,
-- with the holder boost if a fresh check finds a Moon Ranger) or rejects.
-- UNIQUE(wallet, source, source_id) is the lock against paying one match or
-- one challenge-period twice.
CREATE TABLE IF NOT EXISTS game_pending_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  source TEXT NOT NULL,          -- 'match' | 'challenge' | 'share'
  source_id TEXT NOT NULL,       -- match id, or challenge id + ':' + period
  base_fp INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'earned',  -- earned | claimed | approved | rejected
  boost REAL,                    -- 1.25 for a verified holder at approval, else 1
  awarded_fp INTEGER,            -- what was actually credited
  note TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  decided_at INTEGER,
  UNIQUE (wallet, source, source_id));
CREATE INDEX IF NOT EXISTS game_pending_points_status ON game_pending_points(status, claimed_at);
CREATE INDEX IF NOT EXISTS game_pending_points_wallet ON game_pending_points(wallet, status);
