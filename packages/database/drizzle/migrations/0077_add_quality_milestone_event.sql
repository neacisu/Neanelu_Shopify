-- Purpose: allow milestone_reached in prod_quality_events

ALTER TABLE prod_quality_events
  DROP CONSTRAINT IF EXISTS chk_quality_event_type;

ALTER TABLE prod_quality_events
  ADD CONSTRAINT chk_quality_event_type
  CHECK (event_type IN ('quality_promoted', 'quality_demoted', 'review_requested', 'milestone_reached'));
