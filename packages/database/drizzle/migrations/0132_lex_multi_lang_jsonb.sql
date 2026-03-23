-- f1-21: Add JSONB `translations` column to support multiple target languages.
-- Structure: { "ro": { "display_text": "...", "description": "..." }, "fr": { ... } }

ALTER TABLE shopify_collections
  ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}';

ALTER TABLE lex_sense_clusters
  ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}';

ALTER TABLE lex_terms
  ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}';

ALTER TABLE lex_domain_profiles
  ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}';
