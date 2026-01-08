-- Migration: 0053_oauth_states_return_to.sql
-- PR-028: Preserve return path after OAuth install
-- Description: add optional return_to to oauth_states for post-auth redirect

ALTER TABLE oauth_states
	ADD COLUMN IF NOT EXISTS return_to TEXT;

COMMENT ON COLUMN oauth_states.return_to IS 'Optional UI return path within /app (open-redirect-safe, validated server-side)';
