import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';

import { useApiClient } from '../../hooks/use-api';
import { usePolling } from '../../hooks/use-polling';
import { useEnrichmentStream } from '../../hooks/useEnrichmentStream';
import { InfoTooltip } from '../ui/info-tooltip';

type NotificationItem = Readonly<{
  id: string;
  type: string;
  title: string;
  body: Record<string, unknown>;
  read: boolean;
  created_at: string;
}>;

export function NotificationBell() {
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const stream = useEnrichmentStream();
  const lastPushedNotificationIdRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const unread = usePolling({
    queryKey: ['notifications-unread'],
    interval: 60_000,
    queryFn: () => api.getApi<{ count: number }>('/pim/notifications/unread-count'),
  });
  const notifications = usePolling({
    queryKey: ['notifications-recent'],
    interval: 60_000,
    queryFn: () => api.getApi<{ notifications: NotificationItem[] }>('/pim/notifications'),
  });

  const unreadCount = unread.data?.count ?? 0;
  const items = useMemo(
    () => (notifications.data?.notifications ?? []).slice(0, 10),
    [notifications.data]
  );

  useEffect(() => {
    const evt = stream.events[0];
    if (evt?.type !== 'quality.event') return;
    const id = typeof evt.payload['id'] === 'string' ? evt.payload['id'] : null;
    if (!id || lastPushedNotificationIdRef.current === id) return;
    lastPushedNotificationIdRef.current = id;
    void unread.refetch();
    void notifications.refetch();
  }, [notifications.refetch, stream.events, unread.refetch]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <div className="sr-only">
        <InfoTooltip title="Notificări">
          Aici vezi notificările importante din aplicație: alerte de sistem, finalizări de
          sincronizare și evenimente de calitate a datelor. Dacă ai elemente necitite, numărul lor
          apare ca badge pe iconiță.
        </InfoTooltip>
      </div>
      <button
        type="button"
        className="interactive relative inline-flex items-center rounded-lg border border-border/70 bg-card px-2.5 py-2 text-muted shadow-[var(--shadow-xs)] focus-ring-standard"
        onClick={() => {
          setOpen((prev) => !prev);
          void unread.refetch();
          void notifications.refetch();
        }}
        aria-label={`Notificări${unreadCount > 0 ? ` (${unreadCount} necitite)` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span
            className="ml-2 inline-flex min-w-5 justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground motion-safe:animate-[number-pop_0.3s_var(--ease-spring)_both]"
            aria-live="polite"
          >
            {unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 z-30 mt-2 w-[340px] origin-top-right rounded-xl border border-border/70 bg-card p-3 shadow-[var(--shadow-lg)] backdrop-blur-sm motion-safe:animate-[scale-in_180ms_ease-out]"
          role="dialog"
          aria-label="Panou notificări"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-foreground">Notificări</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="interactive rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10 focus-ring-standard"
                aria-label="Marchează toate notificările ca citite"
                onClick={() => {
                  void api.postApi<{ updated: number }, Record<string, never>>(
                    '/pim/notifications/mark-all-read',
                    {}
                  );
                  void unread.refetch();
                  void notifications.refetch();
                }}
              >
                Marchează toate ca citite
              </button>
              <button
                type="button"
                className="interactive rounded-md p-1 text-muted hover:bg-subtle/60 hover:text-foreground"
                onClick={() => setOpen(false)}
                aria-label="Închide notificări"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
          <div
            className="max-h-80 space-y-1.5 overflow-auto"
            role="list"
            aria-live="polite"
            aria-label="Lista notificări"
          >
            {items.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted">Nu există notificări</div>
            ) : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="listitem"
                className={`interactive w-full rounded-lg border p-2.5 text-left ${
                  item.read
                    ? 'border-border/60 hover:bg-subtle/40'
                    : 'border-primary/25 bg-primary/5 hover:bg-primary/10'
                }`}
                onClick={() => {
                  void api.putApi<{ updated: boolean }, Record<string, never>>(
                    `/pim/notifications/${item.id}/read`,
                    {}
                  );
                  void unread.refetch();
                  void notifications.refetch();
                }}
              >
                <div className="text-sm font-medium text-foreground">{item.title}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {new Date(item.created_at).toLocaleString('ro-RO')}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
