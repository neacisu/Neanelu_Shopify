import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ro } from 'date-fns/locale';

import { InfoTooltip } from '../ui/info-tooltip';

const REFRESH_INTERVAL_SEC = 15;

export type RealtimeQueueStatusProps = Readonly<{
  connected: boolean;
  lastSnapshotAt: number | null;
  countdownRemainingSec: number;
  showRefreshBurst: boolean;
  error: string | null;
  snapshotError: string | null;
}>;

/** Wrapper that owns countdown state so the parent page does not re-render every second. */
export type RealtimeQueueStatusWithCountdownProps = Readonly<{
  connected: boolean;
  lastSnapshotAt: number | null;
  showRefreshBurst: boolean;
  error: string | null;
  snapshotError: string | null;
}>;

export function RealtimeQueueStatusWithCountdown({
  connected,
  lastSnapshotAt,
  showRefreshBurst,
  error,
  snapshotError,
}: RealtimeQueueStatusWithCountdownProps) {
  const [countdownRemainingSec, setCountdownRemainingSec] = useState(REFRESH_INTERVAL_SEC);

  useEffect(() => {
    if (lastSnapshotAt !== null) setCountdownRemainingSec(REFRESH_INTERVAL_SEC);
  }, [lastSnapshotAt]);

  useEffect(() => {
    if (!connected) return;
    const id = window.setInterval(() => {
      setCountdownRemainingSec((prev) => Math.max(0, prev - 1));
    }, 1_000);
    return () => window.clearInterval(id);
  }, [connected]);

  useEffect(() => {
    if (!connected || countdownRemainingSec !== 0) return;
    const t = window.setTimeout(() => setCountdownRemainingSec(REFRESH_INTERVAL_SEC), 1_000);
    return () => window.clearTimeout(t);
  }, [connected, countdownRemainingSec]);

  return (
    <RealtimeQueueStatus
      connected={connected}
      lastSnapshotAt={lastSnapshotAt}
      countdownRemainingSec={countdownRemainingSec}
      showRefreshBurst={showRefreshBurst}
      error={error}
      snapshotError={snapshotError}
    />
  );
}

export function RealtimeQueueStatus({
  connected,
  lastSnapshotAt,
  countdownRemainingSec,
  showRefreshBurst,
  error,
  snapshotError,
}: RealtimeQueueStatusProps) {
  if (!connected) {
    const errorLabel =
      error === 'session_required'
        ? 'Autentificare necesară (deschide din Shopify Admin sau reîncarcă pagina)'
        : error;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-warning/60 bg-warning/5 px-3 py-1.5 text-sm font-medium text-warning"
          aria-live="polite"
        >
          <span className="size-2 rounded-full bg-warning" aria-hidden />
          Offline
        </span>
        {errorLabel ? (
          <span className="text-caption text-muted" title={error ?? undefined}>
            {errorLabel}
          </span>
        ) : null}
      </div>
    );
  }

  const progressPct = Math.max(0, (countdownRemainingSec / REFRESH_INTERVAL_SEC) * 100);

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 sm:flex-row sm:items-center sm:gap-4"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`
 inline-flex items-center gap-1.5 rounded-full border border-success/50 bg-success/10 px-3 py-1.5 text-sm font-medium text-success
 ${showRefreshBurst ? 'motion-safe:animate-[queueRefreshBurst_0.6s_ease-out]' : ''}
 ${!showRefreshBurst ? 'motion-safe:animate-[queueLivePulse_2.5s_ease-in-out_infinite]' : ''}
 `}
            aria-hidden={showRefreshBurst}
          >
            <span
              className="size-2 rounded-full bg-success ring-2 ring-success/40 motion-safe:animate-[pulse_2s_ease-in-out_infinite]"
              aria-hidden
            />
            In timp real
          </span>
          <InfoTooltip title="În timp real" side="bottom" maxWidth={360}>
            Datele cozilor se actualizează automat prin WebSocket la fiecare 15 secunde. Nu e nevoie
            să reîncarci pagina pentru a vedea statusurile curente. Bara de progres arată cât mai e
            până la următorul refresh.
          </InfoTooltip>
        </span>
        {lastSnapshotAt !== null ? (
          <span
            className="text-caption text-muted"
            title="Data și ora ultimului refresh primit de la server"
          >
            Ultimul refresh: la {format(lastSnapshotAt, 'HH:mm:ss', { locale: ro })}
            {snapshotError ? (
              <span className="ml-1 text-warning" title={snapshotError}>
                (eșuat)
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-caption text-muted">Aștept primul snapshot…</span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:min-w-[140px]">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-success/20"
          role="progressbar"
          aria-valuenow={countdownRemainingSec}
          aria-valuemin={0}
          aria-valuemax={REFRESH_INTERVAL_SEC}
          aria-label={`Următorul refresh în ${countdownRemainingSec} secunde`}
        >
          <div
            className="h-full rounded-full bg-success transition-[width] duration-1000 ease-linear"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-[11px] text-muted tabular-nums">
          Următorul refresh în {countdownRemainingSec} s
        </span>
      </div>
    </div>
  );
}
