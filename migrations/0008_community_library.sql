BEGIN;

-- ============================================================================
-- Enums
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE visibility AS ENUM ('private', 'shared', 'public');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE collection_role AS ENUM ('owner', 'editor', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_status AS ENUM ('open', 'reviewed_ok', 'removed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_target AS ENUM ('station', 'collection', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- Stations — visibility, counters, published_at
-- ============================================================================
ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS visibility visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS published_at timestamp,
  ADD COLUMN IF NOT EXISTS star_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fork_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS practice_count integer NOT NULL DEFAULT 0;

-- (stations.forkOf already exists per survey — no change needed)

-- ============================================================================
-- Collections — visibility, counters, published_at
-- ============================================================================
ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS visibility visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS published_at timestamp,
  ADD COLUMN IF NOT EXISTS star_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fork_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fork_of integer REFERENCES collections(id) ON DELETE SET NULL;

-- ============================================================================
-- Users — admin flag + bio
-- ============================================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bio text;

-- Seed Nasser as admin (idempotent)
UPDATE users SET is_admin = true WHERE email = 'nasrww13@hotmail.com';

-- ============================================================================
-- Collection members
-- ============================================================================
CREATE TABLE IF NOT EXISTS collection_members (
  id serial PRIMARY KEY,
  collection_id integer NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role collection_role NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  UNIQUE (collection_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_members_user ON collection_members(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_members_collection ON collection_members(collection_id);

-- Backfill: owner rows for every existing collection
INSERT INTO collection_members (collection_id, user_id, role)
SELECT c.id, c.user_id, 'owner'::collection_role
FROM collections c
LEFT JOIN collection_members cm
  ON cm.collection_id = c.id AND cm.user_id = c.user_id
WHERE cm.id IS NULL;

-- ============================================================================
-- Collection invites
-- ============================================================================
CREATE TABLE IF NOT EXISTS collection_invites (
  id serial PRIMARY KEY,
  collection_id integer NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  email varchar(255) NOT NULL,
  role collection_role NOT NULL,
  token text NOT NULL UNIQUE,
  invited_by integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamp NOT NULL,
  accepted_at timestamp,
  accepted_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collection_invites_token ON collection_invites(token);
CREATE INDEX IF NOT EXISTS idx_collection_invites_email_open ON collection_invites(email) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_collection_invites_collection ON collection_invites(collection_id);

-- ============================================================================
-- Stars
-- ============================================================================
CREATE TABLE IF NOT EXISTS station_stars (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id integer NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  created_at timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, station_id)
);

CREATE INDEX IF NOT EXISTS idx_station_stars_station ON station_stars(station_id);

CREATE TABLE IF NOT EXISTS collection_stars (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id integer NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  created_at timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, collection_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_stars_collection ON collection_stars(collection_id);

-- ============================================================================
-- Reports (moderation)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reports (
  id serial PRIMARY KEY,
  target_type report_target NOT NULL,
  target_id integer NOT NULL,
  reporter_id integer REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  status report_status NOT NULL DEFAULT 'open',
  reviewed_by integer REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp,
  notes text,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_status_open ON reports(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);

-- ============================================================================
-- Partial indexes for public browsing
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_stations_public ON stations(published_at DESC NULLS LAST) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_collections_public ON collections(published_at DESC NULLS LAST) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_stations_specialty_public ON stations(specialty) WHERE visibility = 'public';

COMMIT;
