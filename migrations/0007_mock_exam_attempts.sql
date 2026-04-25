-- Mock Exam Attempts: repeatable runs of a mock exam template.
-- Before this migration, `mock_exams` held both the template (name, stationIds,
-- practiceMode, duration, restDuration) AND runtime/progress (currentStationIndex,
-- startedAt, completedAt). That made each mock exam a one-shot — to "repeat" a
-- circuit the user had to create a new mock exam.
--
-- After this migration, `mock_exams` = template. A new `mock_exam_attempts`
-- table holds one row per run-through with (startedAt, completedAt,
-- currentStationIndex, overallScore, attemptNumber). Station sessions now
-- reference the attempt via `sessions.mock_exam_attempt_id` in addition to
-- the legacy `sessions.mock_exam_id` (kept so old data remains queryable).
--
-- The runtime/progress columns on `mock_exams` (status, currentStationIndex,
-- startedAt, completedAt) are now DEPRECATED and unused by the application.
-- They are intentionally NOT dropped here: dropping would (a) risk losing
-- data for any in-flight exam that hasn't yet been migrated to an attempt
-- row, and (b) break any reads still referencing them. They can be dropped
-- in a later cleanup migration once we're confident no call sites remain.
--
-- Idempotent: safe to run multiple times.

-- ─── 1. Table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mock_exam_attempts (
  id SERIAL PRIMARY KEY,
  mock_exam_id INTEGER NOT NULL REFERENCES mock_exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  current_station_index INTEGER NOT NULL DEFAULT 0,
  overall_score REAL,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mock_exam_attempts_user ON mock_exam_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_mock_exam_attempts_exam ON mock_exam_attempts(mock_exam_id);
-- Monotonic attempt number per (user, exam) pair. Enforced at the DB level
-- so two concurrent POSTs can't collide on the same number.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mock_exam_attempts_unique_number
  ON mock_exam_attempts(user_id, mock_exam_id, attempt_number);

-- ─── 2. Sessions FK to attempts ────────────────────────────────────────
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS mock_exam_attempt_id INTEGER
  REFERENCES mock_exam_attempts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_mock_exam_attempt
  ON sessions(mock_exam_attempt_id);

-- ─── 3. Backfill: convert existing in-flight / completed exams to attempt #1 ──
-- For every existing mock exam, create an attempt #1 row capturing its
-- current runtime state. If the exam is `draft` with no startedAt and no
-- sessions attached, we skip — there's no "attempt" to preserve, the user
-- simply hasn't started. Sessions that already reference this exam via
-- `mock_exam_id` get their `mock_exam_attempt_id` set to this new row.
DO $$
DECLARE
  r RECORD;
  new_attempt_id INTEGER;
BEGIN
  FOR r IN
    SELECT me.id, me.user_id, me.status, me.current_station_index,
           me.started_at, me.completed_at
    FROM mock_exams me
    WHERE me.started_at IS NOT NULL
       OR me.status = 'completed'
       OR me.status = 'in_progress'
       OR EXISTS (SELECT 1 FROM sessions s WHERE s.mock_exam_id = me.id)
  LOOP
    -- Skip if an attempt already exists for this exam (re-run safety).
    IF EXISTS (
      SELECT 1 FROM mock_exam_attempts
      WHERE mock_exam_id = r.id AND user_id = r.user_id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO mock_exam_attempts (
      mock_exam_id, user_id, attempt_number,
      current_station_index, started_at, completed_at
    ) VALUES (
      r.id, r.user_id, 1,
      COALESCE(r.current_station_index, 0),
      COALESCE(r.started_at, NOW()),
      r.completed_at
    )
    RETURNING id INTO new_attempt_id;

    -- Link the existing station sessions to this attempt.
    UPDATE sessions
    SET mock_exam_attempt_id = new_attempt_id
    WHERE mock_exam_id = r.id
      AND mock_exam_attempt_id IS NULL;
  END LOOP;
END $$;
