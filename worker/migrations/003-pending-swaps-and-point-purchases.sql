-- Step 3. Two new tables: swaps the browser could not finish recording, and
-- Fox Points bought with USDC.
--
--   cd worker && npx wrangler d1 execute solquicks-points --remote --yes --file migrations/003-pending-swaps-and-point-purchases.sql
--
-- Safe to run as many times as you like: every statement is IF NOT EXISTS.
--
-- Until these exist, buying points answers 500 and the sweep that finishes
-- interrupted swaps has nowhere to keep them.

-- Signatures the page hands over before confirming, so the scheduled sweep can
-- finish recording a swap whatever happens to the browser. Recording used to
-- run only in the page after confirmation, so closing the tab lost the swap and
-- its points for good. Rows are deleted as soon as they are recorded, or once
-- they are too old to ever land.
CREATE TABLE IF NOT EXISTS pending_swaps (
  signature TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  last_try INTEGER);

CREATE INDEX IF NOT EXISTS pending_swaps_age ON pending_swaps(created_at);

-- Fox Points bought with USDC. The money is verified on chain against this
-- row's reference before any point is credited, and the status flip from
-- 'held' is the lock that stops a second confirm paying twice.
CREATE TABLE IF NOT EXISTS point_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  wallet TEXT NOT NULL,
  usd REAL NOT NULL,
  bonus_pct INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL,
  status TEXT NOT NULL,
  hold_until INTEGER,
  signature TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  reference TEXT);

CREATE INDEX IF NOT EXISTS point_purchases_wallet ON point_purchases(wallet);
