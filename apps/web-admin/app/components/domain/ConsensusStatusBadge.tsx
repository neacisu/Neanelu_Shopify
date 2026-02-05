type ConsensusStatus = 'pending' | 'computed' | 'conflicts' | 'manual_review';

const STATUS_LABELS: Record<ConsensusStatus, string> = {
  pending: 'Pending',
  computed: 'Computed',
  conflicts: 'Conflicts',
  manual_review: 'Review',
};

const STATUS_STYLES: Record<ConsensusStatus, string> = {
  pending: 'bg-muted/20 text-muted',
  computed: 'bg-success/15 text-success',
  conflicts: 'bg-warning/15 text-warning',
  manual_review: 'bg-error/15 text-error',
};

export function ConsensusStatusBadge({ status }: { status: ConsensusStatus }) {
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
