import { useMemo, useState } from 'react';
import { Bell } from 'lucide-react';

import { useApiClient } from '../../hooks/use-api';
import { usePolling } from '../../hooks/use-polling';

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

  return (
    <div className="relative">
      <button
        type="button"
        className="relative inline-flex items-center rounded-md border border-muted/20 bg-background px-3 py-2 text-caption shadow-sm hover:bg-muted/10"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="ml-2 inline-flex min-w-5 justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-white">
            {unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[340px] rounded-md border border-muted/20 bg-background p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Notifications</div>
            <button
              type="button"
              className="text-xs text-primary"
              onClick={() => {
                void api.putApi<{ updated: number }, Record<string, never>>(
                  '/pim/notifications/mark-all-read',
                  {}
                );
                void unread.refetch();
                void notifications.refetch();
              }}
            >
              Mark all as read
            </button>
          </div>
          <div className="max-h-80 space-y-2 overflow-auto">
            {items.length === 0 ? <div className="text-sm text-muted">No notifications</div> : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`w-full rounded-md border p-2 text-left ${
                  item.read ? 'border-muted/20' : 'border-primary/30 bg-primary/5'
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
                <div className="text-sm font-medium">{item.title}</div>
                <div className="text-xs text-muted">
                  {new Date(item.created_at).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
