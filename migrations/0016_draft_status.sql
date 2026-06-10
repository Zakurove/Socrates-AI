-- ============================================================================
-- Draft status flag for stations.
--
-- The editor auto-POSTs a minimal station as soon as the user types a title
-- (see EDITOR_UX_FIXES.md, Issue 3). Those rows are technically saved but
-- not yet "owned" by the user as intentional content. is_draft = true marks
-- them so the UI can de-emphasize them and a periodic cleanup can purge
-- stale auto-saved rows.
--
-- Existing rows pre-migration default to false (not drafts).
-- ============================================================================

-- Idempotent: this column already exists on prod (applied during the
-- auto-save / draft cleanup work that landed earlier). IF NOT EXISTS
-- lets the file sit in the repo without breaking re-runs.
ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false;
