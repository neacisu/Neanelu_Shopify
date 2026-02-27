import { useCallback, useMemo, useState } from 'react';

import type { DashboardAlert, DashboardAlertsResponse } from '@app/types';
import { useQuery } from '@tanstack/react-query';

import { createApiClient } from '../../../lib/api-client';
import { getSessionAuthHeaders } from '../../../lib/session-auth';
import { Button } from '../../../components/ui/button';
import { InfoTooltip } from '../../../components/ui/info-tooltip';

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

const alertTooltips: Record<string, { title: string; body: string }> = {
  redis_down: {
    title: 'Redis Indisponibil',
    body: 'CE ESTE: Redis (memoria cache și cozile) nu răspunde. DE CE CONTEAZĂ: Fără Redis, cache-ul, cozile de procesare și deduplicarea webhooks nu funcționează. EXEMPLU: Job-urile noi nu vor fi procesate, iar dashboard-ul poate afișa date vechi. SFAT: Verifică conexiunea Redis din Setări sau contactează administratorul de sistem.',
  },
  api_slow: {
    title: 'API Lent',
    body: 'CE ESTE: Latența API depășește pragul de 2 secunde (p95). DE CE CONTEAZĂ: Cereri lente pot cauza timeout-uri și experiență degradată pentru utilizatori. EXEMPLU: Operațiunile de enrichment și sincronizare ar putea dura de 3–5x mai mult. SFAT: Verifică încărcarea serverului, conexiunea Redis și backlog-ul cozilor.',
  },
  jobs_backlog: {
    title: 'Backlog Ridicat',
    body: 'CE ESTE: Peste 1.000 de job-uri așteaptă procesare în cozi. DE CE CONTEAZĂ: Un backlog mare indică că procesatorii nu pot ține pasul cu cerințele. EXEMPLU: 2.500 job-uri în așteptare = aproximativ 30–60 minute de procesare. SFAT: Adaugă workeri suplimentari sau prioritizează cozile critice.',
  },
};

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
    <div className="space-y-3">
      {visibleAlerts.map((a) => {
        const tooltip = alertTooltips[a.id];
        return (
          <div
            key={a.id}
            role="status"
            className={
              a.severity === 'critical'
                ? 'rounded-xl border border-red-200/80 bg-red-50/80 p-4 shadow-[var(--shadow-sm)] dark:border-red-800/60 dark:bg-red-950/40'
                : 'rounded-xl border border-amber-200/80 bg-amber-50/80 p-4 shadow-[var(--shadow-sm)] dark:border-amber-800/60 dark:bg-amber-950/40'
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {a.title}
                  {tooltip ? (
                    <InfoTooltip title={tooltip.title} side="bottom">
                      {tooltip.body}
                    </InfoTooltip>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {a.description}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => dismiss(a.id)}>
                Închide
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
