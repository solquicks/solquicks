CREATE TABLE IF NOT EXISTS players (
  wallet     TEXT PRIMARY KEY,
  points     INTEGER NOT NULL DEFAULT 0,
  last_visit TEXT,
  migrated   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  type   TEXT NOT NULL,
  points INTEGER NOT NULL,
  ts     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_wallet ON events(wallet, ts DESC);
CREATE INDEX IF NOT EXISTS idx_players_points ON players(points DESC);
CREATE TABLE IF NOT EXISTS stakes (
  wallet TEXT PRIMARY KEY,
  staked INTEGER NOT NULL DEFAULT 0,
  since  INTEGER NOT NULL DEFAULT 0,
  count  INTEGER NOT NULL DEFAULT 0,
  banked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token   TEXT PRIMARY KEY,
  wallet  TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nonces (
  nonce   TEXT PRIMARY KEY,
  wallet  TEXT NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS staked_nfts (
  wallet TEXT NOT NULL,
  mint   TEXT NOT NULL,
  since  INTEGER NOT NULL,
  PRIMARY KEY (wallet, mint)
);
CREATE TABLE IF NOT EXISTS payments (
  signature TEXT PRIMARY KEY,
  wallet    TEXT NOT NULL,
  lamports  INTEGER NOT NULL,
  purpose   TEXT NOT NULL,
  ts        INTEGER NOT NULL
);

-- Plushie points used to be granted for clicking "Buy Now", which awarded 500
-- points to anyone who clicked and never bought. Points are now tied to a code
-- issued per real store.fun order and redeemable exactly once.
CREATE TABLE IF NOT EXISTS plushie_codes (
  code        TEXT PRIMARY KEY,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  redeemed_by TEXT,
  redeemed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_plushie_unredeemed ON plushie_codes(redeemed_at);

-- ── Everything below was added to production over time without being written
-- back here, so this file could not rebuild the live database. Recovered from the
-- live D1 schema on 2026-09-14; structure only, no data. Keep it in step: a table
-- created by hand in the dashboard and not added here is one a rebuild loses.

CREATE TABLE IF NOT EXISTS banner_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE, wallet TEXT,
  weeks INTEGER NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  total_usd REAL NOT NULL, sol_price REAL, lamports INTEGER, signature TEXT,
  status TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, hold_until INTEGER,
  name TEXT, contact TEXT, sponsor TEXT, headline TEXT, url TEXT, image_url TEXT,
  created_at INTEGER NOT NULL, paid_at INTEGER, reference TEXT, group_ref TEXT);

CREATE TABLE IF NOT EXISTS banner_stats (slot TEXT NOT NULL, day TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (slot, day));

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  wallet TEXT,
  type_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  starts_at INTEGER,
  minutes INTEGER,
  base_usd REAL NOT NULL,
  rush_pct INTEGER NOT NULL DEFAULT 0,
  discount_pct INTEGER NOT NULL DEFAULT 0,
  total_usd REAL NOT NULL,
  sol_price REAL,
  lamports INTEGER,
  signature TEXT,
  status TEXT NOT NULL,
  hold_until INTEGER,
  name TEXT, contact TEXT, brief TEXT,
  created_at INTEGER NOT NULL, paid_at INTEGER, reference TEXT, group_ref TEXT);

-- A basket paid for in one go. The bookings and ad runs inside it each hold
-- their own slot from the moment they are added; this row only carries the
-- single payment that settles all of them. starts_at is always NULL: a cart
-- has no time of its own, which is what lets it share the settlement path
-- with bookings and ad runs.
CREATE TABLE IF NOT EXISTS cart_groups (ref TEXT PRIMARY KEY, wallet TEXT, total_usd REAL NOT NULL, status TEXT NOT NULL, hold_until INTEGER, name TEXT, contact TEXT, created_at INTEGER NOT NULL, reference TEXT, signature TEXT, paid_at INTEGER, starts_at INTEGER);

CREATE TABLE IF NOT EXISTS collectibles (wallet TEXT PRIMARY KEY, asset TEXT NOT NULL UNIQUE, signature TEXT NOT NULL, minted_at INTEGER NOT NULL, points INTEGER NOT NULL DEFAULT 0);

-- which basket settled this row, if it was not paid for on its own
CREATE TABLE IF NOT EXISTS error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, route TEXT, message TEXT);

CREATE TABLE IF NOT EXISTS flips (id INTEGER PRIMARY KEY AUTOINCREMENT, wallet TEXT NOT NULL, wager INTEGER NOT NULL, won INTEGER NOT NULL, ts INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS floor_snapshots (taken_at INTEGER PRIMARY KEY, source TEXT NOT NULL, floor_lamports INTEGER NOT NULL, listed INTEGER, volume_7d INTEGER);

CREATE TABLE IF NOT EXISTS health_log (ts INTEGER PRIMARY KEY, ok INTEGER NOT NULL, detail TEXT);

CREATE TABLE IF NOT EXISTS holder_positions (wallet TEXT PRIMARY KEY, count INTEGER NOT NULL, first_seen INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS holder_snapshots (taken_at INTEGER PRIMARY KEY, holders INTEGER NOT NULL, supply INTEGER NOT NULL, whales INTEGER NOT NULL, mid INTEGER NOT NULL, small INTEGER NOT NULL, top10_pct REAL);

CREATE TABLE IF NOT EXISTS kv_cache (k TEXT PRIMARY KEY, n INTEGER NOT NULL, ts INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS mission_draws (mission_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, snapshot_hash TEXT NOT NULL, total_tickets INTEGER NOT NULL, winner_count INTEGER NOT NULL, randomness TEXT, winners TEXT, draw_account TEXT, commit_signature TEXT, fulfill_signature TEXT, created_at INTEGER NOT NULL, drawn_at INTEGER);

CREATE TABLE IF NOT EXISTS mission_results (mission_id TEXT NOT NULL, wallet TEXT NOT NULL, tickets INTEGER NOT NULL, rangers INTEGER NOT NULL, ranger_days INTEGER NOT NULL, streak INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (mission_id, wallet));

CREATE TABLE IF NOT EXISTS mission_rewards (id INTEGER PRIMARY KEY AUTOINCREMENT, mission_id TEXT NOT NULL, wallet TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, detail TEXT, claimed INTEGER NOT NULL DEFAULT 0, claimed_at INTEGER);

CREATE TABLE IF NOT EXISTS missions (id TEXT PRIMARY KEY, label TEXT NOT NULL, starts INTEGER NOT NULL, ends INTEGER NOT NULL, sponsor TEXT, prize TEXT, status TEXT NOT NULL DEFAULT 'open');

CREATE TABLE IF NOT EXISTS rate_limits (k TEXT PRIMARY KEY, n INTEGER NOT NULL, expires INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS swap_awards (signature TEXT PRIMARY KEY, wallet TEXT NOT NULL, usd REAL NOT NULL, points INTEGER NOT NULL, ts INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS idx_banner_run ON banner_bookings(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_bookings_starts ON bookings(starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_wallet ON bookings(wallet);
CREATE INDEX IF NOT EXISTS idx_error_ts ON error_log(ts);
CREATE INDEX IF NOT EXISTS idx_holder_positions_count ON holder_positions(count DESC);
CREATE INDEX IF NOT EXISTS idx_rewards_wallet ON mission_rewards(wallet, claimed);
CREATE INDEX IF NOT EXISTS idx_rl_expires ON rate_limits(expires);
CREATE INDEX IF NOT EXISTS idx_swap_awards_wallet ON swap_awards(wallet, ts);

-- Swap history, one row per swap made through the site. Every column is read
-- from the chain at record time; symbols and dollar value are kept as they were
-- then, since both change afterwards. fee_mint is null when no fee was paid.
CREATE TABLE IF NOT EXISTS swaps (signature TEXT PRIMARY KEY, wallet TEXT NOT NULL, in_mint TEXT NOT NULL, in_symbol TEXT, in_amount REAL NOT NULL, out_mint TEXT NOT NULL, out_symbol TEXT, out_amount REAL NOT NULL, usd REAL, fee_mint TEXT, fee_amount REAL, fee_bps INTEGER, saved_usd REAL NOT NULL DEFAULT 0, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_swaps_wallet ON swaps(wallet, ts);

-- Weekly swap leaderboard prizes, one row per place per week. The primary key is
-- what stops a second run of the scheduled job paying anyone twice.
CREATE TABLE IF NOT EXISTS swap_weekly_awards (week TEXT NOT NULL, rank INTEGER NOT NULL, wallet TEXT NOT NULL, usd REAL NOT NULL, points INTEGER NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (week, rank));
CREATE INDEX IF NOT EXISTS idx_swaps_ts ON swaps(ts);
