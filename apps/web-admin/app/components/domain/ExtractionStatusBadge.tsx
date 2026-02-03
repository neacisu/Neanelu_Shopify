interface ExtractionStatusBadgeProps {
  status: 'pending' | 'in_progress' | 'complete' | 'failed';
}

const STATUS_STYLES: Record<ExtractionStatusBadgeProps['status'], string> = {
  pending: 'bg-muted/20 text-muted',
  in_progress: 'bg-blue-500/15 text-blue-600',
  complete: 'bg-success/15 text-success',
  failed: 'bg-error/15 text-error',
};

const STATUS_LABELS: Record<ExtractionStatusBadgeProps['status'], string> = {
  pending: 'pending',
  in_progress: 'in progress',
  complete: 'complete',
  failed: 'failed',
};

export function ExtractionStatusBadge({ status }: ExtractionStatusBadgeProps) {
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
