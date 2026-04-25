-- ============================================================================
-- Migration 0011: add user_id + FK + index to ai_costs
--
-- Motivation: pre-migration, Gemini Live calls logged with session_id=null,
-- making per-user cost attribution impossible and breaking the daily-spend
-- cap primitive. This migration adds `user_id`, backfills from sessions
-- where possible, and adds a supporting index.
-- ============================================================================

-- 1. Add the column (nullable — legacy rows have no attribution).
ALTER TABLE ai_costs
  ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- 2. Backfill from sessions where session_id is present.
UPDATE ai_costs
SET user_id = sessions.user_id
FROM sessions
WHERE ai_costs.session_id = sessions.id
  AND ai_costs.user_id IS NULL;

-- 3. Indexes for cost aggregation.
CREATE INDEX IF NOT EXISTS ai_costs_user_id_created_at_idx
  ON ai_costs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_costs_created_at_idx
  ON ai_costs (created_at DESC);

-- 4. Add an FK on session_id for cascade-safe deletes. session_id is already
-- nullable, so this is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_costs_session_id_fk'
  ) THEN
    ALTER TABLE ai_costs
      ADD CONSTRAINT ai_costs_session_id_fk
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
  END IF;
END$$;
