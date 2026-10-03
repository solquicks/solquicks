-- Step 2 of 2. The new tables, plus the indexes.
--
--   cd worker && npx wrangler d1 execute solquicks-points --remote --yes --file migrations/002-bundles-and-calendar.sql
--
-- Safe to run as many times as you like: every statement is IF NOT EXISTS, so
-- a second run changes nothing and still reports success. Run step 1 first —
-- the last index here needs the column it adds.

-- A bundle of sessions, bought at once and cheaper per session. The money
-- lives here; each session redeemed from it is an ordinary row in `bookings`
-- with bundle_ref pointing back, priced at zero because it is already paid.
-- Credits are counted from those rows and never stored, so a tally cannot
-- drift away from the bookings it is supposed to describe.
CREATE TABLE IF NOT EXISTS bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  wallet TEXT,
  bundle_id TEXT NOT NULL,
  type_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  base_usd REAL NOT NULL,
  discount_pct INTEGER NOT NULL DEFAULT 0,
  total_usd REAL NOT NULL,
  signature TEXT,
  status TEXT NOT NULL,
  hold_until INTEGER,
  -- starts counting from the day it is paid for, not the day it is bought
  expires_at INTEGER,
  name TEXT, contact TEXT, brief TEXT,
  created_at INTEGER NOT NULL, paid_at INTEGER, reference TEXT, group_ref TEXT, site_slug TEXT,
  -- never reserves time of its own; here so the settle statement binds alike
  starts_at INTEGER
);

CREATE INDEX IF NOT EXISTS bundles_status ON bundles(status);

-- Which Google Calendar event stands for which booking. Keyed by the booking
-- so a payment settled twice — by the page, the wallet and the sweep all
-- noticing it — updates one event instead of creating three.
CREATE TABLE IF NOT EXISTS calendar_events (
  booking_ref TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  synced_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS bookings_bundle ON bookings(bundle_ref);
