-- SUPERSEDED — do not apply. No worker route reads any table defined here; the
-- game schema is in worker/schema.sql and migrations/004-game-tables.sql.
-- Kept for reference only.
--
-- Moon Rangers FPS — additive DB migrations v2
-- Apply to production with: npx wrangler d1 execute solquicks-points --file=worker/src/game/schema_v2.sql
-- ADDITIVE ONLY: no DROP, ALTER COLUMN, or RENAME — only ADD COLUMN and CREATE TABLE IF NOT EXISTS.

-- ── Game sessions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_sessions (
  id         TEXT PRIMARY KEY,
  wallet     TEXT,
  creator_id TEXT NOT NULL DEFAULT 'solquicks',
  started_at INTEGER NOT NULL,
  ended_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_game_sessions_wallet     ON game_sessions(wallet);
CREATE INDEX IF NOT EXISTS idx_game_sessions_creator    ON game_sessions(creator_id);

-- ── Game matches ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_matches (
  id         TEXT PRIMARY KEY,
  mode       TEXT NOT NULL DEFAULT 'tdm',
  map        TEXT,
  winner     TEXT,
  creator_id TEXT NOT NULL DEFAULT 'solquicks',
  started_at INTEGER NOT NULL,
  ended_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_game_matches_creator ON game_matches(creator_id, ended_at DESC);

-- ── Match players ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_match_players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id   TEXT NOT NULL,
  wallet     TEXT,
  role       TEXT,
  team       TEXT,
  kills      INTEGER NOT NULL DEFAULT 0,
  deaths     INTEGER NOT NULL DEFAULT 0,
  assists    INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  creator_id TEXT NOT NULL DEFAULT 'solquicks'
);
CREATE INDEX IF NOT EXISTS idx_gmp_wallet    ON game_match_players(wallet);
CREATE INDEX IF NOT EXISTS idx_gmp_creator   ON game_match_players(creator_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmp_match_wallet ON game_match_players(match_id, wallet) WHERE wallet IS NOT NULL;

-- ── In-game purchases ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_purchases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet     TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  item_type  TEXT NOT NULL,
  cost       INTEGER NOT NULL,
  creator_id TEXT NOT NULL DEFAULT 'solquicks',
  ts         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_purchases_wallet  ON game_purchases(wallet);
CREATE INDEX IF NOT EXISTS idx_game_purchases_creator ON game_purchases(creator_id);

-- ── Creator configs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_creators (
  creator_id      TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  accent_color    TEXT NOT NULL DEFAULT '#7eb8ff',
  logo_url        TEXT,
  leaderboard_url TEXT,
  points_label    TEXT NOT NULL DEFAULT 'Fox Points',
  owner_wallet    TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL
);

-- ── Share reward claims (daily tweet bonus) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS game_share_claims (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet      TEXT NOT NULL,
  claim_type  TEXT NOT NULL DEFAULT 'daily_tweet',
  points      INTEGER NOT NULL DEFAULT 25,
  creator_id  TEXT NOT NULL DEFAULT 'solquicks',
  claimed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_share_claims_wallet ON game_share_claims(wallet, claimed_at DESC);

-- ── Leaderboard view (points + wins + kills per wallet per creator) ──────────
-- Drop and recreate view if it exists (views are cheap to replace)
DROP VIEW IF EXISTS game_leaderboard;
CREATE VIEW game_leaderboard AS
SELECT
  gmp.wallet,
  gmp.creator_id,
  SUM(gmp.points_earned)                                        AS points,
  SUM(CASE WHEN gm.winner = gmp.team THEN 1 ELSE 0 END)        AS wins,
  SUM(gmp.kills)                                                AS kills,
  SUM(gmp.deaths)                                               AS deaths
FROM game_match_players gmp
LEFT JOIN game_matches gm ON gm.id = gmp.match_id
WHERE gmp.wallet IS NOT NULL
GROUP BY gmp.wallet, gmp.creator_id;
