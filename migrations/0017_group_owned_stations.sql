-- Group-owned stations: when a station is added to a collection, the server
-- now forks it and the fork lives under the collection (not under the
-- sharer's personal "My Stations"). Editors in the collection can modify
-- the fork freely; the original author's personal station is never touched.
--
-- `collection_id` IS NULL → personal station (the default)
-- `collection_id` IS NOT NULL → group copy owned by that collection.
--                                userId still points at the user who minted
--                                the fork (for analytics/audit), but edit
--                                rights flow from collection membership.

ALTER TABLE stations
  ADD COLUMN IF NOT EXISTS collection_id INTEGER
    REFERENCES collections(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_stations_collection_id
  ON stations(collection_id)
  WHERE collection_id IS NOT NULL;
