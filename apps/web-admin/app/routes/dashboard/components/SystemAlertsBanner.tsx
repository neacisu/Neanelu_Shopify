import { useCallback, useMemo, useState } from 'react';

import type { DashboardAlert, DashboardAlertsResponse } from '@app/types';
import { useQuery } from '@tanstack/react-query';

import { createApiClient } from '../../../lib/api-client';
import { getSessionAuthHeaders } from '../../../lib/session-auth';
import { Button } from '../../../components/ui/button';

const api = createApiClient({ getAuthHeaders: getSessionAuthHeaders });

const STORAGE_KEY = 'neanelu.dashboard.dismissed_alerts.v1';
type DismissedMap = Record<string, true>;

const LOAD_ID =
  typeof window !== 'undefined' &&
  typeof window.crypto !== 'undefined' &&
  typeof window.crypto.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : String(Date.now());

type StoredDismissals = Readonly<{
  loadId: string;
  dismissed: DismissedMap;
}>;

function loadDismissed(): DismissedMap {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const stored = parsed as Partial<StoredDismissals>;

    // Dismissals are scoped to the current "page session" (module load). This keeps
    // the banner dismissible during navigation, but it will re-appear after a refresh
    // if the underlying problem still exists (as required by the plan).
    if (stored.loadId !== LOAD_ID) {
      const empty: StoredDismissals = { loadId: LOAD_ID, dismissed: {} };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(empty));
      return {};
    }

    return stored.dismissed ?? {};
  } catch {
    return {};
  }
}

function saveDismissed(map: DismissedMap): void {
  try {
    const payload: StoredDismissals = { loadId: LOAD_ID, dismissed: map };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function SystemAlertsBanner() {
  const [dismissed, setDismissed] = useState<DismissedMap>(() =>
    typeof window === 'undefined' ? {} : loadDismissed()
  );

  const query = useQuery({
    queryKey: ['dashboard', 'alerts'],
    queryFn: () => api.getApi<DashboardAlertsResponse>('/dashboard/alerts'),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const dismiss = useCallback(
    (id: string) => {
      const next = { ...dismissed, [id]: true as const } as DismissedMap;
      setDismissed(next);
      saveDismissed(next);
    },
    [dismissed]
  );

  const visibleAlerts = useMemo<DashboardAlert[]>(() => {
    const alerts = query.data?.alerts ?? [];
    return alerts
      .filter((a) => {
        return dismissed[a.id] !== true;
      })
      .slice(0, 3);
  }, [query.data, dismissed]);

  if (!visibleAlerts.length) return null;

  return (
    <div className="space-y-2">
      {visibleAlerts.map((a) => (
        <div
          key={a.id}
          role="status"
          className={
            a.severity === 'critical'
              ? 'rounded-md border border-red-500/30 bg-red-500/10 p-3'
              : 'rounded-md border border-amber-500/30 bg-amber-500/10 p-3'
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{a.title}</div>
              <div className="mt-1 text-xs text-muted">{a.description}</div>
            </div>
            <Button variant="secondary" onClick={() => dismiss(a.id)}>
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
