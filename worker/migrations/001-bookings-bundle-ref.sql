-- Step 1 of 2. Adds the one new column on an existing table.
--
--   cd worker && npx wrangler d1 execute solquicks-points --remote --yes --file migrations/001-bookings-bundle-ref.sql
--
-- Marks a booking that was redeemed from a bundle rather than bought on its own.
--
-- NOT safe to run twice. SQLite has no "ADD COLUMN IF NOT EXISTS", so a second
-- run fails with "duplicate column name: bundle_ref". That error means this
-- step has already been done — ignore it and carry on to step 2.
ALTER TABLE bookings ADD COLUMN bundle_ref TEXT;
