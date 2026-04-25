BEGIN;

-- ============================================================================
-- stations.fork_of — add real FK with ON DELETE SET NULL
-- ----------------------------------------------------------------------------
-- 0008 left stations.fork_of as a plain integer column. This migration
-- promotes it to a real foreign key so that deleting a source station
-- cleanly nulls the fork pointer on children instead of leaving a dangling id.
-- Idempotent: the ALTER TABLE is wrapped in a DO block that swallows
-- duplicate_object so reruns on an already-constrained column are no-ops.
-- ============================================================================

-- Guard: if any rows currently point at a now-missing station id, null them
-- out first so the constraint will accept.
UPDATE stations
SET fork_of = NULL
WHERE fork_of IS NOT NULL
  AND fork_of NOT IN (SELECT id FROM stations);

DO $$ BEGIN
  ALTER TABLE stations
    ADD CONSTRAINT stations_fork_of_fkey
    FOREIGN KEY (fork_of) REFERENCES stations(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

COMMIT;
