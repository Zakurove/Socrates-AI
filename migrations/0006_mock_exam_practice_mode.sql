-- Mock Exam: practice mode chosen at creation time
-- All stations in a mock exam run in the same mode (mirrors a real OSCE
-- circuit which is one format throughout). Existing rows default to
-- `self_check` for backwards compat.
-- Idempotent: safe to run multiple times.

-- 1. Enum
DO $$ BEGIN
  CREATE TYPE mock_exam_practice_mode AS ENUM ('self_check', 'ai_listen', 'ai_conversation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Column
ALTER TABLE mock_exams
  ADD COLUMN IF NOT EXISTS practice_mode mock_exam_practice_mode NOT NULL DEFAULT 'self_check';
