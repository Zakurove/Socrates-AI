-- Examiner questions upgraded to first-class study material.
--
-- New columns on examiner_questions:
--   description: context / setup text shown alongside the question
--   explanation: why the ideal answer is what it is (study material,
--                hidden during exam phase by default)
--
-- New table examiner_question_media (parallels item_media):
--   phase      → 'question' (attached to the question itself) or
--                'explanation' (attached to the answer/explanation)
--   visibility → 'exam'  (shown during examination)
--              | 'study' (shown only in study / post-answer review)
--              | 'both'  (always)
--
-- The legacy examiner_questions.image_url column stays for backwards
-- compatibility and is backfilled into examiner_question_media as a
-- phase='question', visibility='exam' row. Old clients reading
-- image_url still get the same image; new clients read the media array.

-- CREATE TYPE has no IF NOT EXISTS form pre-PG14; wrap in a DO block so
-- the migration is safe to re-run.
DO $$ BEGIN
  CREATE TYPE examiner_media_phase AS ENUM ('question', 'explanation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE examiner_media_visibility AS ENUM ('exam', 'study', 'both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE examiner_questions
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS explanation TEXT;

CREATE TABLE IF NOT EXISTS examiner_question_media (
  id            SERIAL PRIMARY KEY,
  question_id   INTEGER NOT NULL
                  REFERENCES examiner_questions(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('image', 'video')),
  url           TEXT NOT NULL,
  caption       TEXT,
  "order"       INTEGER NOT NULL DEFAULT 0,
  phase         examiner_media_phase NOT NULL DEFAULT 'question',
  visibility    examiner_media_visibility NOT NULL DEFAULT 'exam'
);

CREATE INDEX IF NOT EXISTS idx_examiner_question_media_qid
  ON examiner_question_media(question_id);

-- Backfill legacy image_url entries as phase='question' visibility='exam'.
-- Idempotent guard: skip questions that already have a matching media row.
INSERT INTO examiner_question_media (question_id, type, url, "order", phase, visibility)
SELECT eq.id, 'image', eq.image_url, 0, 'question', 'exam'
FROM examiner_questions eq
WHERE eq.image_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM examiner_question_media m
    WHERE m.question_id = eq.id AND m.url = eq.image_url
  );
