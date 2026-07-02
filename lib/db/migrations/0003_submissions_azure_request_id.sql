-- Migration 0003: track the Azure async pipeline request_id for submissions
-- in "analyzing" status. Required because on Vercel we cannot keep polling
-- active in the process (functions are ephemeral, max 60s). The cron job
-- every minute reads this column to poll Azure Functions.
-- Author: Pasquale Marzaioli

ALTER TABLE submissions
  ADD COLUMN azure_request_id varchar(64);

CREATE INDEX submissions_azure_request_id_idx
  ON submissions (azure_request_id)
  WHERE azure_request_id IS NOT NULL;
