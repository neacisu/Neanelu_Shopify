interface TriageStatusBadgeProps {
  status: 'auto_approve' | 'ai_audit' | 'hitl_required' | 'rejected';
}

const STATUS_STYLES: Record<TriageStatusBadgeProps['status'], string> = {
  auto_approve: 'bg-success/15 text-success',
  ai_audit: 'bg-info/15 text-info',
  hitl_required: 'bg-warning/15 text-warning',
  rejected: 'bg-error/15 text-error',
};

export function TriageStatusBadge({ status }: TriageStatusBadgeProps) {
  const label =
    status === 'auto_approve'
      ? 'Auto'
      : status === 'ai_audit'
        ? 'AI Review'
        : status === 'hitl_required'
          ? 'Human Review'
          : 'Rejected';
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {label}
    </span>
  );
}
