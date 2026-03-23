-- Migration: 0124_lex_terms_watermarks_governance_updated_at_triggers.sql
-- Purpose: Align lex_terms, lex_source_watermarks, lex_governance_requests with
--          the same BEFORE UPDATE updated_at trigger pattern as 0115 triggered_tables.

-- ============================================
-- updated_at triggers (pattern from 0115)
-- ============================================

DO $$
DECLARE
  tbl TEXT;
  triggered_tables TEXT[] := ARRAY[
    'lex_terms',
    'lex_source_watermarks',
    'lex_governance_requests'
  ];
BEGIN
  FOREACH tbl IN ARRAY triggered_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || tbl || '_updated_at', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
      'trg_' || tbl || '_updated_at',
      tbl
    );
  END LOOP;
END $$;
