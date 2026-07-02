-- Migration 0005: per-company (per-facility) subscription tier.
--
-- Moves the subscription tier from the account (users.tier) to the facility, so one
-- account can hold Premium for one company and Basic for another. Two new columns on
-- `facilities`:
--   tier                   — the facility's live plan (basic|premium). Drives the
--                            dashboard blur (Basic data is withheld), the daily Telegram
--                            grouping, and the admin 90-day history gate.
--   stripe_subscription_id — the recurring subscription funding that facility's plan,
--                            needed to cancel the old Basic subscription on upgrade.
--
-- Backfill precedence for `tier` (highest first):
--   1. the facility's LATEST submission's tier_at_submission (the tier actually paid);
--   2. the owning user's deprecated users.tier (only for facilities with no submissions);
--   3. the column DEFAULT 'basic' (everything else).
--
-- users.tier and users.stripe_subscription_id are kept (to avoid a destructive
-- migration) but are no longer read as gates. users.stripe_customer_id stays in use.
--
-- Safe to run on existing local/dev data and idempotent (ADD COLUMN IF NOT EXISTS, and
-- the backfills only touch rows that still hold the default).
-- Author: Pasquale Marzaioli

-- 1. The facility's live tier. DEFAULT 'basic' immediately fills every existing row,
--    so the column is NOT NULL from the start; the backfills below refine it.
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS tier varchar(16) NOT NULL DEFAULT 'basic';

-- 2. The subscription funding this facility's plan. Nullable and non-unique on purpose
--    (one user / one Stripe customer can fund several facilities).
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS stripe_subscription_id varchar(64);

-- 3. Backfill tier from the facility's LATEST submission (the most recent renewal wins),
--    using the immutable tier_at_submission snapshot of the tier that was actually paid.
UPDATE facilities f
SET tier = sub.tier
FROM (
  SELECT DISTINCT ON (facility_id) facility_id, tier_at_submission AS tier
  FROM submissions
  WHERE facility_id IS NOT NULL
  ORDER BY facility_id, id DESC
) sub
WHERE f.id = sub.facility_id
  AND sub.tier IN ('basic', 'premium');

-- 4. Fallback to the owning user's deprecated tier ONLY for facilities that have no
--    submissions at all (so step 3 left them at the 'basic' default).
UPDATE facilities f
SET tier = u.tier
FROM users u
WHERE f.user_id = u.id
  AND u.tier IN ('basic', 'premium')
  AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.facility_id = f.id);

-- 5. Best-effort backfill of stripe_subscription_id from the user's (deprecated)
--    account-level subscription, so existing Basic facilities have a subscription to
--    cancel when upgraded. Only fills rows that are still NULL.
UPDATE facilities f
SET stripe_subscription_id = u.stripe_subscription_id
FROM users u
WHERE f.user_id = u.id
  AND u.stripe_subscription_id IS NOT NULL
  AND f.stripe_subscription_id IS NULL;
