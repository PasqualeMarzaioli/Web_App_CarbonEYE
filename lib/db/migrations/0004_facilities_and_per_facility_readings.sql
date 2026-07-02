-- Migration 0004: per-facility monitoring tabs.
--
-- Introduces a first-class `facilities` table (one row per monitored site = one
-- dashboard tab), links submissions and emissions_readings to it, and re-keys the
-- per-day uniqueness from (user_id, date) to (facility_id, date) so one account can
-- monitor multiple facilities in parallel without daily-reading collisions.
--
-- Safe to run on existing local/dev data: the backfill (steps 3-8) attaches every
-- existing submission and reading to a facility before the new constraints are added.
-- Author: Pasquale Marzaioli

-- 1. The facilities table — the stable identity of a monitoring tab. Survives
--    certificate renewals (a renewal is a new submission pointing at the same facility).
CREATE TABLE IF NOT EXISTS facilities (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        varchar(255) NOT NULL,
  industry    varchar(120),
  lat         double precision NOT NULL,
  lon         double precision NOT NULL,
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_user_id_idx ON facilities (user_id);

-- 2. Link columns (added nullable so the backfill can populate them before we
--    enforce NOT NULL / the new unique constraint).
ALTER TABLE submissions        ADD COLUMN IF NOT EXISTS facility_id integer REFERENCES facilities(id) ON DELETE SET NULL;
ALTER TABLE emissions_readings ADD COLUMN IF NOT EXISTS facility_id integer REFERENCES facilities(id) ON DELETE CASCADE;
ALTER TABLE breach_log         ADD COLUMN IF NOT EXISTS facility_id integer REFERENCES facilities(id) ON DELETE CASCADE;

-- 3. Backfill: one facility per (user_id, rounded lat, rounded lon). Coordinates are
--    rounded to 6 decimals (~0.1 m) so the same physical site collapses to a single
--    facility even if two submissions stored microscopically different floats. The
--    earliest submission supplies the facility name/industry/created_at.
INSERT INTO facilities (user_id, name, industry, lat, lon, created_at)
SELECT DISTINCT ON (s.user_id, round(s.lat::numeric, 6), round(s.lon::numeric, 6))
       s.user_id, s.company_name, s.industry, s.lat, s.lon, s.created_at
FROM submissions s
ORDER BY s.user_id, round(s.lat::numeric, 6), round(s.lon::numeric, 6), s.created_at ASC;

-- 4. Point each submission at its facility (match on user + rounded coordinates).
UPDATE submissions s
SET facility_id = f.id
FROM facilities f
WHERE f.user_id = s.user_id
  AND round(f.lat::numeric, 6) = round(s.lat::numeric, 6)
  AND round(f.lon::numeric, 6) = round(s.lon::numeric, 6)
  AND s.facility_id IS NULL;

-- 5. Propagate facility_id to readings that already carry a submission_id.
UPDATE emissions_readings er
SET facility_id = s.facility_id
FROM submissions s
WHERE s.id = er.submission_id
  AND er.facility_id IS NULL;

-- 6. Orphan readings (submission_id NULL — inserted by the daily worker keyed only on
--    user): attach to the facility of that user's latest certified submission.
UPDATE emissions_readings er
SET facility_id = sub.facility_id
FROM (
  SELECT DISTINCT ON (user_id) user_id, facility_id
  FROM submissions
  WHERE status = 'certified' AND facility_id IS NOT NULL
  ORDER BY user_id, id DESC
) sub
WHERE er.user_id = sub.user_id
  AND er.facility_id IS NULL;

-- 7. Last-resort fallback: any remaining orphan readings attach to the user's first
--    facility (covers users whose submissions are all uncertified). Readings with no
--    facility at all (no facility for that user) are deleted — they cannot belong to a tab.
UPDATE emissions_readings er
SET facility_id = sub.facility_id
FROM (
  SELECT DISTINCT ON (user_id) user_id, id AS facility_id
  FROM facilities
  ORDER BY user_id, id ASC
) sub
WHERE er.user_id = sub.user_id
  AND er.facility_id IS NULL;
DELETE FROM emissions_readings WHERE facility_id IS NULL;

-- 8. Backfill breach_log.facility_id from the linked reading.
UPDATE breach_log bl
SET facility_id = er.facility_id
FROM emissions_readings er
WHERE er.id = bl.reading_id
  AND bl.facility_id IS NULL;

-- 9. Swap the per-day uniqueness from (user_id, date) to (facility_id, date). Remove any
--    duplicate (facility_id, date) pairs first, keeping the most-recently inserted row.
DELETE FROM emissions_readings
WHERE id NOT IN (
  SELECT MAX(id) FROM emissions_readings GROUP BY facility_id, date
);
ALTER TABLE emissions_readings DROP CONSTRAINT IF EXISTS emissions_readings_user_date_unique;
ALTER TABLE emissions_readings ALTER COLUMN facility_id SET NOT NULL;
ALTER TABLE emissions_readings
  ADD CONSTRAINT emissions_readings_facility_date_unique UNIQUE (facility_id, date);
