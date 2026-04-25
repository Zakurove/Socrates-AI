-- Feature 1: Section-level images and description
ALTER TABLE sections ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS image_caption TEXT;

-- Feature 2: Multiple images and videos per item
CREATE TABLE IF NOT EXISTS item_media (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image', 'video')),
  url TEXT NOT NULL,
  caption TEXT,
  "order" INTEGER NOT NULL DEFAULT 0
);
