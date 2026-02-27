import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

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
    // Real-time: PIM events stream pushes quality events; those create notifications in DB.
    const evt = stream.events[0];
    if (evt?.type !== 'quality.event') return;
    const id = typeof evt.payload['id'] === 'string' ? evt.payload['id'] : null;
    if (!id || lastPushedNotificationIdRef.current === id) return;
    lastPushedNotificationIdRef.current = id;
    void unread.refetch();
    void notifications.refetch();
  }, [notifications.refetch, stream.events, unread.refetch]);

  return (
    <div className="relative">
      <div className="sr-only">
        <InfoTooltip title="Notificări">
          Aici vezi notificările importante din aplicație: alerte de sistem, finalizări de
          sincronizare și evenimente de calitate a datelor. Dacă ai elemente necitite, numărul lor
          apare ca badge pe iconiță.
        </InfoTooltip>
      </div>
      <button
        type="button"
        className="relative inline-flex items-center rounded-md border border-muted/20 bg-background px-3 py-2 text-caption shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-muted/10 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
        onClick={() => {
          setOpen((prev) => !prev);
          void unread.refetch();
          void notifications.refetch();
        }}
        aria-label="Notificări"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="ml-2 inline-flex min-w-5 justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-white">
            {unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[340px] animate-[scale-in_180ms_ease-out] rounded-md border border-muted/20 bg-background p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium dark:text-slate-100">Notificări</div>
            <button
              type="button"
              className="text-xs text-primary dark:text-blue-400"
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
          </div>
          <div className="max-h-80 space-y-2 overflow-auto">
            {items.length === 0 ? (
              <div className="text-sm text-muted dark:text-slate-400">Nu există notificări</div>
            ) : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`w-full rounded-md border p-2 text-left transition ${
                  item.read
                    ? 'border-muted/20 dark:border-slate-700'
                    : 'border-primary/30 bg-primary/5 dark:border-blue-500/30 dark:bg-blue-900/10'
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
                <div className="text-sm font-medium dark:text-slate-100">{item.title}</div>
                <div className="text-xs text-muted dark:text-slate-400">
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
