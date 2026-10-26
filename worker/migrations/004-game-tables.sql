-- Step 4. Moon Rangers: match results and challenge claims, which the game
-- routes used to create on every request with CREATE TABLE IF NOT EXISTS.
--
--   cd worker && npx wrangler d1 execute solquicks-points --remote --yes --file migrations/004-game-tables.sql
--
-- Safe to run as many times as you like: every statement is IF NOT EXISTS.
--
-- The match tables are new names on purpose. Production may hold an older
-- game_matches / game_match_players in one of two incompatible shapes (the old
-- request-time CREATE in routes.js, or src/game/schema_v2.sql), and IF NOT
-- EXISTS would silently keep whichever is there. Neither was ever written to:
-- match/end sat behind the session gate and always answered 401.
--
-- game_challenge_claims keeps its name and shape, so claims already made are
-- still honoured. If it is missing, this creates it.
--
-- Until these exist, every /api/game route except a bad request answers 500.

-- One row per match the game server reported. The first match/end fixes the
-- result; a replay cannot change the winner.
CREATE TABLE IF NOT EXISTS game_match_records (
  id TEXT PRIMARY KEY,
  map TEXT,
  mode TEXT NOT NULL DEFAULT 'tdm',
  winning_team TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER);

-- One row per player per match. The primary key is the lock that stops a
-- replayed match/end paying anyone twice. ended_at is copied from the match so
-- the period leaderboards need no join.
CREATE TABLE IF NOT EXISTS game_match_awards (
  match_id TEXT NOT NULL,
  wallet TEXT NOT NULL,
  team TEXT NOT NULL,
  hero TEXT,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0,
  fp_awarded INTEGER NOT NULL DEFAULT 0,
  ended_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, wallet));
CREATE INDEX IF NOT EXISTS game_match_awards_ended ON game_match_awards(ended_at);
CREATE INDEX IF NOT EXISTS game_match_awards_wallet ON game_match_awards(wallet);

-- Challenges and the daily share bonus, once per wallet per period. period_key
-- is YYYY-MM-DD for a daily, YYYY-Www (ISO week) for a weekly.
CREATE TABLE IF NOT EXISTS game_challenge_claims (
  wallet TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  fp_awarded INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER NOT NULL,
  period_key TEXT NOT NULL,
  PRIMARY KEY (wallet, challenge_id, period_key));
