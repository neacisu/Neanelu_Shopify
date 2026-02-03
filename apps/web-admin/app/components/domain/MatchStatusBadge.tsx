interface MatchStatusBadgeProps {
  status: 'pending' | 'confirmed' | 'rejected' | 'uncertain';
}

const STATUS_STYLES: Record<MatchStatusBadgeProps['status'], string> = {
  pending: 'bg-warning/15 text-warning',
  confirmed: 'bg-success/15 text-success',
  rejected: 'bg-error/15 text-error',
  uncertain: 'bg-amber-200/20 text-amber-700',
};

export function MatchStatusBadge({ status }: MatchStatusBadgeProps) {
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}
