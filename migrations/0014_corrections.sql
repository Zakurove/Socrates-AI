-- ============================================================================
-- User-corrections on grading results.
--
-- After a session ends the user can flip any per-item or per-examiner-question
-- result if the AI matcher got it wrong. The user's flip becomes the new
-- source of truth for their personal score and history; the AI's original
-- verdict is preserved alongside so we can analyse where the matcher was
-- wrong and feed that back into prompt tuning / future training.
--
-- Schema decisions:
--   1. item_results / examiner_question_results gain `ai_*` columns that
--      freeze the matcher's original answer. The existing status / score
--      columns continue to hold the user's current view.
--   2. A row is "corrected" iff status != ai_status (items) or
--      score != ai_score (questions). corrected_at timestamps the most
--      recent deviation; it clears to NULL when the user flips back to
--      the AI's original.
--   3. A dedicated correction_events table logs every flip event so we
--      keep multi-flip history (user changes mind 3 times) for richer
--      telemetry — current-state lives on the result row, audit log
--      lives in this table.
-- ============================================================================

-- ── item_results ────────────────────────────────────────────────────────────
ALTER TABLE item_results
  ADD COLUMN ai_status item_status,
  ADD COLUMN corrected_at timestamp,
  ADD COLUMN correction_note text;

-- Backfill ai_status from the existing status. Every legacy row pre-dates
-- this feature so by definition the AI's call is whatever was saved.
UPDATE item_results SET ai_status = status WHERE ai_status IS NULL;

-- After backfill the column is safe to make NOT NULL — every new row will
-- set ai_status at insert time too.
ALTER TABLE item_results ALTER COLUMN ai_status SET NOT NULL;

-- ── examiner_question_results ──────────────────────────────────────────────
ALTER TABLE examiner_question_results
  ADD COLUMN ai_score real,
  ADD COLUMN corrected_at timestamp,
  ADD COLUMN correction_note text;

-- Backfill: ai_score = current score for every legacy row.
UPDATE examiner_question_results SET ai_score = score WHERE ai_score IS NULL;
-- Not NOT NULL'd because the existing score column is also nullable (some
-- sessions never reached the examiner phase). ai_score follows the same
-- shape — null when score is null, set when score is set.

-- ── correction_events (audit log) ──────────────────────────────────────────
-- One row per flip event. Lets us track multi-flip history (user flipped
-- A->B->A; current-state shows uncorrected but two events live here).
CREATE TYPE correction_target AS ENUM ('item_result', 'question_result');

CREATE TABLE correction_events (
  id            serial PRIMARY KEY,
  session_id    integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type   correction_target NOT NULL,
  target_id     integer NOT NULL,        -- item_results.id OR examiner_question_results.id
  -- Snapshot of the AI's original verdict at flip time, so analysis doesn't
  -- need to chase the parent row.
  ai_value      text NOT NULL,           -- "checked"/"missed" or numeric score as text
  -- Before and after the flip (the user's previous view → new view).
  from_value    text NOT NULL,
  to_value      text NOT NULL,
  note          text,
  occurred_at   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_correction_events_session ON correction_events (session_id);
CREATE INDEX idx_correction_events_target  ON correction_events (target_type, target_id);
CREATE INDEX idx_correction_events_user    ON correction_events (user_id, occurred_at DESC);
