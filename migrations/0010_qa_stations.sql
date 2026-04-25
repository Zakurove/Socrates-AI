BEGIN;

-- ============================================================================
-- Q&A stations + richer examiner question types
-- ----------------------------------------------------------------------------
-- Adds:
--   - station_type enum value 'qa' (pure Q&A / oral station)
--   - examiner_question_type enum (free_text, multiple_choice, multi_select)
--   - examiner_questions.question_type, .config jsonb, .image_url
-- Makes examiner_questions.ideal_answer nullable (MCQ/multi-select don't need it).
-- Existing rows default to 'free_text' — no data migration needed.
-- Idempotent via IF NOT EXISTS / DO blocks.
-- ============================================================================

-- 1. Extend station_type enum. ALTER TYPE ... ADD VALUE is not transactional in
--    older PG versions, so this runs inside BEGIN but with IF NOT EXISTS which
--    is safe from PG 12+.
ALTER TYPE station_type ADD VALUE IF NOT EXISTS 'qa';

-- 2. Create examiner_question_type enum (idempotent via DO block).
DO $$ BEGIN
  CREATE TYPE examiner_question_type AS ENUM ('free_text', 'multiple_choice', 'multi_select');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Add new columns to examiner_questions.
ALTER TABLE examiner_questions
  ADD COLUMN IF NOT EXISTS question_type examiner_question_type NOT NULL DEFAULT 'free_text',
  ADD COLUMN IF NOT EXISTS config jsonb,
  ADD COLUMN IF NOT EXISTS image_url varchar(500);

-- 4. Relax ideal_answer to NULL-able. MCQ/multi-select don't need a prose answer.
DO $$ BEGIN
  ALTER TABLE examiner_questions ALTER COLUMN ideal_answer DROP NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

COMMIT;
