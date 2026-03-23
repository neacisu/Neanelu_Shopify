-- Allow governance requests to record failed apply (e.g. glossary ON CONFLICT DO NOTHING).
ALTER TABLE lex_governance_requests
  DROP CONSTRAINT IF EXISTS chk_lex_governance_requests_status;

ALTER TABLE lex_governance_requests
  ADD CONSTRAINT chk_lex_governance_requests_status
  CHECK (
    status IN (
      'draft',
      'pending_approval',
      'approved',
      'rejected',
      'applied',
      'cancelled',
      'apply_failed'
    )
  );
