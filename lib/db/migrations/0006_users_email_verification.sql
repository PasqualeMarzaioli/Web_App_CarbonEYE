-- Migration 0006: email verification on user accounts.
--
-- Signup now requires a confirmed email: login is BLOCKED until the user clicks the
-- verification link (feature 2). Three additive columns on `users`:
--   email_verified                       — false until the user confirms; gates login.
--   email_verification_token             — single-use token emailed in the verify link.
--   email_verification_token_expires_at  — 24h expiry for that token.
--
-- CRITICAL backfill: every EXISTING account must keep working. Without the UPDATE below
-- they would all default to email_verified=false and be locked out by the new login gate.
-- New accounts are inserted with email_verified=false (admins with true) by the register
-- route, so this one-time backfill only affects rows that predate the column.
--
-- Additive and idempotent (ADD COLUMN IF NOT EXISTS), consistent with the no-down-script
-- convention of 0004/0005. The backfill is naturally idempotent: a re-run finds no rows
-- still at the default because new inserts set the flag explicitly.
-- Author: Pasquale Marzaioli

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token varchar(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token_expires_at timestamp;

-- Backfill: confirm every pre-existing account so the new gate never locks anyone out.
UPDATE users SET email_verified = true WHERE email_verified = false;
