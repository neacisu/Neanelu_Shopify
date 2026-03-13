import { useMemo } from 'react';

import { InfoTooltip } from '../ui/info-tooltip';

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
      return { label: 'Conectat', className: 'border-success/30 bg-success/10 text-success' };
    }
    if (status === 'degraded') {
      return { label: 'Degradat', className: 'border-warning/30 bg-warning/10 text-warning' };
    }
    return { label: 'Deconectat', className: 'border-error/30 bg-error/10 text-error' };
  }, [status]);

  return (
    <div className="space-y-3 rounded-md border border-muted/20 bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Status conexiune</span>
        <InfoTooltip title="Status conexiune Shopify" side="bottom" portalToBody>
          Verifică dacă aplicația poate comunica cu API-ul Shopify. Conectat = totul OK. Degradat =
          rate limit sau probleme temporare. Deconectat = token expirat sau invalid.
        </InfoTooltip>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${badge.className}`}
        >
          {status === 'connected' ? (
            <span
              className="size-2 rounded-full bg-success motion-safe:animate-[pulse_2s_ease-in-out_infinite]"
              aria-hidden
            />
          ) : null}
          {badge.label}
        </span>
        <span className="text-sm text-muted">
          Token: {tokenHealthy ? 'OK' : 'Necesită atenție'}
        </span>
        {typeof rateLimitRemaining === 'number' ? (
          <span className="text-sm text-muted">Rate limit rămas: {rateLimitRemaining}</span>
        ) : null}
      </div>

      <div className="text-xs text-muted">
        Ultima verificare: {checkedAt ? new Date(checkedAt).toLocaleString('ro-RO') : '—'}
      </div>

      {!tokenHealthy ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Tokenul Shopify necesită reautorizare. Reconectează magazinul pentru a evita erori de API.
        </div>
      ) : null}

      {scopes.length ? (
        <div className="text-xs text-muted">Permisiuni: {scopes.join(', ')}</div>
      ) : null}
    </div>
  );
}
