-- ============================================================================
-- "Checklist" examiner question type.
--
-- Adds a fourth value to examiner_question_type enum: `checklist`. A checklist
-- question expects N specific items (signs, symptoms, triggers, differentials)
-- and scores by exact count covered / total. `keyPoints` (existing jsonb on
-- examiner_questions) carries the canonical list of expected items.
--
-- Persists the per-item breakdown so the results page can show
-- which items the student covered / missed without re-running the matcher.
-- ============================================================================

ALTER TYPE examiner_question_type ADD VALUE IF NOT EXISTS 'checklist';

-- Per-item breakdown for a question result. Shape:
--   [{ "point": "<string from keyPoints>", "status": "present" | "missed" }]
-- Null for non-checklist questions (and for legacy checklist rows pre-feature).
ALTER TABLE examiner_question_results
  ADD COLUMN point_results jsonb;
