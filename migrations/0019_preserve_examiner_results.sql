-- Preserve historical examiner_question_results when their underlying
-- examiner_question rows are replaced (which happens on every station
-- save — updateStation in storage.ts deletes + reinserts examiner_
-- questions in bulk because the editor doesn't preserve server PKs).
--
-- Before: questionId was NOT NULL + ON DELETE CASCADE → editing a
-- station with any history wiped every past result for it. Sessions
-- still showed but every examiner score evaporated.
--
-- After: questionId is NULLABLE + ON DELETE SET NULL → result rows
-- survive question replacement. The results page degrades gracefully
-- by checking for the presence of the question reference.
--
-- This is independent of the examiner-question schema upgrade in 0018;
-- it's a pre-existing data-loss bug surfaced during the audit.

-- Idempotent: DROP NOT NULL is a no-op if already nullable; constraint
-- drop uses IF EXISTS; constraint re-add is preceded by the drop so it
-- always succeeds.
ALTER TABLE examiner_question_results
  ALTER COLUMN question_id DROP NOT NULL;

ALTER TABLE examiner_question_results
  DROP CONSTRAINT IF EXISTS examiner_question_results_question_id_examiner_questions_id_fk;

ALTER TABLE examiner_question_results
  ADD CONSTRAINT examiner_question_results_question_id_examiner_questions_id_fk
    FOREIGN KEY (question_id)
    REFERENCES examiner_questions(id)
    ON DELETE SET NULL;
