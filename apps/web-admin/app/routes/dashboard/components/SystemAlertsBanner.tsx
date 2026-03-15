import { useCallback, useMemo, useState } from 'react';

import type { DashboardAlert, DashboardAlertsResponse } from '@app/types';
import { useQuery } from '@tanstack/react-query';

import { createApiClient } from '../../../lib/api-client';
import { withAppBasePath } from '../../../lib/base-path';
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
  lex_worker_offline: {
    title: 'Worker Lexical Offline',
    body: 'CE ESTE: Un worker lexical critic nu este online sau nu mai trece readiness checks. DE CE CONTEAZĂ: Pipeline-ul lexical se poate bloca sau încetini, iar publicările și review-ul pot rămâne în urmă. EXEMPLU: worker-ul de publish offline poate lăsa ținte aprobate nepublicate. SFAT: Deschide pagina Cozi pentru a vedea worker-ele și job-ul curent.',
  },
  lex_dlq_present: {
    title: 'Lex DLQ Activ',
    body: 'CE ESTE: Există job-uri lex mutate în Dead Letter Queue. DE CE CONTEAZĂ: Asta indică eșecuri repetitive care nu se mai retrimit automat. EXEMPLU: publish-uri sau shard-uri care au eșuat de mai multe ori și cer replay. SFAT: Deschide coada DLQ relevantă și investighează mesajul de eroare înainte de replay.',
  },
  lex_stale_checkpoints: {
    title: 'Checkpoint-uri Lex Stale',
    body: 'CE ESTE: Unele checkpoint-uri lex nu au mai raportat heartbeat de peste 15 minute. DE CE CONTEAZĂ: Un run poate fi blocat, iar resume-ul automat nu va progresa corect. EXEMPLU: un shard rămas suspendat după un crash de worker. SFAT: Verifică Runs în PIM Translations și worker-ele lex din Cozi.',
  },
  lex_publish_conflicts: {
    title: 'Conflicte de Publicare Lex',
    body: 'CE ESTE: Modulul lexical a detectat conflicte între output-ul său și date existente/manuale din PIM. DE CE CONTEAZĂ: Publicarea automată se oprește intenționat pentru a preveni overwrite-ul nedorit. EXEMPLU: un `prod_translations` manual aprobat blochează write-ul lexical. SFAT: Revizuiește conflictul din workspace-ul lexical înainte de retry.',
  },
  lex_retention_lag: {
    title: 'Retention Lag Lex',
    body: 'CE ESTE: Job-ul de retenție lexicală a rămas în urmă. DE CE CONTEAZĂ: Tabelele hot pot crește inutil și pot afecta costurile și timpul de query. EXEMPLU: fragmente și evenimente de publish vechi nu au fost compactate în ultimele 24h. SFAT: Verifică worker-ul de retention și backlog-ul lui din Cozi.',
  },
  lex_paused_run_budget_blocked: {
    title: 'Run Lex Blocată de Buget',
    body: 'CE ESTE: Un run lexical a fost pus în pauză deoarece guardrail-ul de cost a respins continuarea. DE CE CONTEAZĂ: Traducerile și publicările noi nu vor avansa până la reluare. EXEMPLU: embedding batch sau translation batch oprit pentru că estimarea depășește plafonul. SFAT: Verifică PIM Translations și cost tracking înainte de resume.',
  },
  lex_paused_run_provider_unavailable: {
    title: 'Run Lex Blocată de Provider',
    body: 'CE ESTE: Un run lexical a fost pus în pauză pentru că providerul AI necesar nu este sănătos. DE CE CONTEAZĂ: Pipeline-ul se oprește controlat în loc să corupă starea. EXEMPLU: providerul de batch embedding sau traducere este indisponibil temporar. SFAT: Verifică sănătatea providerilor și apoi reia run-ul din PIM Translations.',
  },
};

function getAlertLinkLabel(alert: DashboardAlert): string {
  if (!alert.href) return 'Vezi detalii';
  if (alert.href.startsWith('/queues')) return 'Deschide coada';
  if (alert.href.startsWith('/pim/translations')) return 'Deschide lex';
  return 'Vezi detalii';
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
    <div className="space-y-3">
      {visibleAlerts.map((a) => {
        const tooltip = alertTooltips[a.id];
        return (
          <div
            key={a.id}
            role={a.severity === 'critical' ? 'alert' : 'status'}
            className={
              a.severity === 'critical'
                ? 'rounded-xl border border-error/30 bg-error/10 p-4 shadow-[var(--shadow-sm)]'
                : 'rounded-xl border border-warning/30 bg-warning/10 p-4 shadow-[var(--shadow-sm)]'
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  {a.title}
                  {tooltip ? (
                    <InfoTooltip title={tooltip.title} side="bottom">
                      {tooltip.body}
                    </InfoTooltip>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-muted">{a.description}</div>
                {a.href ? (
                  <a
                    className="mt-2 inline-block text-xs font-medium text-primary underline"
                    href={withAppBasePath(a.href)}
                  >
                    {getAlertLinkLabel(a)}
                  </a>
                ) : null}
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
