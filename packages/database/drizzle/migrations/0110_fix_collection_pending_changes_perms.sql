-- Fix ownership & permissions for collection_pending_changes table
-- The table was likely created outside of the migration runner (without SET ROLE neanelu_app),
-- so the runtime role cannot access it.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'collection_pending_changes'
  ) THEN
    EXECUTE 'ALTER TABLE collection_pending_changes OWNER TO neanelu_app';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON collection_pending_changes TO neanelu_app;
