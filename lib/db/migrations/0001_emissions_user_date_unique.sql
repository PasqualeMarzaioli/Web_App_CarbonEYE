-- Migration 0001: unique constraint on (user_id, date) for emissions_readings.
--
-- Before adding the constraint, remove any duplicate (user_id, date) pairs that
-- were inserted by the old synthetic seed. For each duplicate group we keep only
-- the row with the highest id (the most-recently inserted reading).
-- Author: Pasquale Marzaioli
DELETE FROM emissions_readings
WHERE id NOT IN (
  SELECT MAX(id)
  FROM emissions_readings
  GROUP BY user_id, date
);

-- One reading per user per calendar day.
-- The daily Python worker upserts on this key so re-runs overwrite rather than
-- duplicate. The initial certificate reading uses the same key.
ALTER TABLE emissions_readings
  ADD CONSTRAINT emissions_readings_user_date_unique UNIQUE (user_id, date);
