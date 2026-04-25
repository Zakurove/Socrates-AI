-- Mock Exams: multi-station timed circuit
-- Reshapes (or creates) the mock_exams table to match the v2 spec.
-- Idempotent: safe to run multiple times.

-- 1. Status enum
DO $$ BEGIN
  CREATE TYPE mock_exam_status AS ENUM ('draft', 'in_progress', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Table
CREATE TABLE IF NOT EXISTS mock_exams (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL DEFAULT 'Untitled mock exam',
  station_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  rest_seconds INTEGER NOT NULL DEFAULT 120,
  status mock_exam_status NOT NULL DEFAULT 'draft',
  current_station_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- 3. Add columns if table pre-existed under the old shape
ALTER TABLE mock_exams ADD COLUMN IF NOT EXISTS title VARCHAR(255) NOT NULL DEFAULT 'Untitled mock exam';
ALTER TABLE mock_exams ADD COLUMN IF NOT EXISTS station_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE mock_exams ADD COLUMN IF NOT EXISTS rest_seconds INTEGER NOT NULL DEFAULT 120;
ALTER TABLE mock_exams ADD COLUMN IF NOT EXISTS status mock_exam_status NOT NULL DEFAULT 'draft';
ALTER TABLE mock_exams ADD COLUMN IF NOT EXISTS current_station_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mock_exams ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE mock_exams ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

-- Old shape required started_at NOT NULL; allow NULL for draft state.
DO $$ BEGIN
  ALTER TABLE mock_exams ALTER COLUMN started_at DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Drop legacy columns from the old shape if present.
ALTER TABLE mock_exams DROP COLUMN IF EXISTS collection_id;
ALTER TABLE mock_exams DROP COLUMN IF EXISTS num_stations;
ALTER TABLE mock_exams DROP COLUMN IF EXISTS time_per_station_seconds;
ALTER TABLE mock_exams DROP COLUMN IF EXISTS break_duration_seconds;
ALTER TABLE mock_exams DROP COLUMN IF EXISTS station_order;
ALTER TABLE mock_exams DROP COLUMN IF EXISTS aggregate_score;
ALTER TABLE mock_exams DROP COLUMN IF EXISTS ended_at;

-- 4. Sessions FK to mock exams (nullable)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mock_exam_id INTEGER
  REFERENCES mock_exams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mock_exams_user ON mock_exams(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_mock_exam ON sessions(mock_exam_id);
