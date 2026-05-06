-- Email address verification.
-- Raw token goes to the user's email; DB stores the SHA-256 digest only.
-- email_verified_at on users is the fast lookup — no join needed at auth time.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS email_verifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,       -- SHA-256 digest of the raw 64-char hex token
  expires_at TIMESTAMP NOT NULL,    -- 24 hours from creation
  used_at TIMESTAMP,                -- set when consumed (one-shot)
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_verifications_user_id_idx ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS email_verifications_expires_at_idx ON email_verifications(expires_at);
