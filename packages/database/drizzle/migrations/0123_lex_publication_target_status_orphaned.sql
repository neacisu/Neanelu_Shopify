-- Allow marking publication targets when the Shopify row no longer exists (e.g. collection deleted).
ALTER TABLE lex_publication_targets DROP CONSTRAINT IF EXISTS chk_lex_publication_targets_status;
ALTER TABLE lex_publication_targets
  ADD CONSTRAINT chk_lex_publication_targets_status
  CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'skipped', 'rolled_back', 'cancelled', 'orphaned'));

ALTER TABLE lex_publish_events DROP CONSTRAINT IF EXISTS chk_lex_publish_events_status;
ALTER TABLE lex_publish_events
  ADD CONSTRAINT chk_lex_publish_events_status
  CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'skipped', 'rolled_back', 'cancelled', 'orphaned'));
