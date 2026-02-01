import { useMemo } from 'react';

type ConnectionStatusProps = Readonly<{
  status: 'connected' | 'degraded' | 'disconnected';
  tokenHealthy: boolean;
  checkedAt: string | null;
  scopes: string[];
  rateLimitRemaining?: number | null;
}>;

export function ConnectionStatus({
  status,
  tokenHealthy,
  checkedAt,
  scopes,
  rateLimitRemaining,
}: ConnectionStatusProps) {
  const badge = useMemo(() => {
    if (status === 'connected') {
      return { label: 'Connected', className: 'border-success/30 bg-success/10 text-success' };
    }
    if (status === 'degraded') {
      return { label: 'Degraded', className: 'border-warning/30 bg-warning/10 text-warning' };
    }
    return { label: 'Disconnected', className: 'border-error/30 bg-error/10 text-error' };
  }, [status]);

  return (
    <div className="space-y-3 rounded-md border border-muted/20 bg-background p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full border px-3 py-1 text-sm ${badge.className}`}>
          {badge.label}
        </span>
        <span className="text-sm text-muted">
          Token health: {tokenHealthy ? 'OK' : 'Needs attention'}
        </span>
        {typeof rateLimitRemaining === 'number' ? (
          <span className="text-sm text-muted">Rate limit remaining: {rateLimitRemaining}</span>
        ) : null}
      </div>

      <div className="text-xs text-muted">
        Ultima verificare: {checkedAt ? new Date(checkedAt).toLocaleString() : '—'}
      </div>

      {scopes.length ? <div className="text-xs text-muted">Scopes: {scopes.join(', ')}</div> : null}
    </div>
  );
}
