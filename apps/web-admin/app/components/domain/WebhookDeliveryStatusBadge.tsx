type Status = 'sent' | 'pending' | 'failed' | 'retrying';

export function WebhookDeliveryStatusBadge(props: { status: Status; title?: string }) {
  const palette =
    props.status === 'sent'
      ? 'border-success/30 bg-success/10 text-success'
      : props.status === 'failed'
        ? 'border-error/30 bg-error/10 text-error'
        : props.status === 'retrying'
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-warning/30 bg-warning/10 text-warning';
  const label =
    props.status === 'sent'
      ? 'Sent'
      : props.status === 'failed'
        ? 'Failed'
        : props.status === 'retrying'
          ? 'Retrying'
          : 'Pending';

  return (
    <span
      title={props.title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${palette}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
