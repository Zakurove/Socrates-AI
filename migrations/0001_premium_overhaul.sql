-- Premium overhaul migration
-- 1. Station type taxonomy: add `image_id`, rewrite legacy rows.
-- 2. Stations: add has_patient_briefing + ai_patient_enabled.
-- 3. Items: add explanation / image / video learning content columns.
-- 4. ai_costs table for OpenAI usage tracking.
--
-- NOTE: Postgres enum values cannot be removed safely without rewriting
-- every dependent column type. We keep `equipment_id` and `oral_qa` in
-- the enum (no rows reference them after this migration) and remove
-- them in a future cleanup migration.

-- 1. Add new enum value (idempotent)
ALTER TYPE station_type ADD VALUE IF NOT EXISTS 'image_id';

-- 2. Rewrite legacy station rows to the new taxonomy.
UPDATE stations SET type = 'image_id' WHERE type = 'equipment_id';
UPDATE stations SET type = 'custom'   WHERE type = 'oral_qa';

-- 3. Stations: progressive-disclosure flags
ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS has_patient_briefing boolean NOT NULL DEFAULT true;
ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS ai_patient_enabled boolean NOT NULL DEFAULT true;

-- Backfill defaults for existing rows so physical/image/custom stations
-- match the new smart-defaults policy.
UPDATE stations
   SET has_patient_briefing = false,
       ai_patient_enabled  = false
 WHERE type IN ('physical_exam', 'image_id', 'custom');

-- 4. Items: learning content (applies to items + sub-items, same table)
ALTER TABLE items ADD COLUMN IF NOT EXISTS explanation   text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS image_url     text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS image_caption text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS video_url     text;

-- 5. ai_costs table
CREATE TABLE IF NOT EXISTS ai_costs (
  id                serial PRIMARY KEY,
  session_id        integer,
  model             varchar(64) NOT NULL,
  tokens_in         integer NOT NULL DEFAULT 0,
  tokens_out        integer NOT NULL DEFAULT 0,
  cost_estimate_usd real    NOT NULL DEFAULT 0,
  created_at        timestamp NOT NULL DEFAULT now()
);
