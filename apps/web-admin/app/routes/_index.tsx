import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  Cpu,
  Layers,
  Package,
  RefreshCw,
  Webhook,
} from 'lucide-react';

import type { ComponentType } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { useCountUp } from '../hooks/useCountUp';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { useScrollReveal } from '../hooks/useScrollReveal';
import type { LoaderFunctionArgs } from 'react-router-dom';
import { useLoaderData, useNavigate, useRevalidator } from 'react-router-dom';
import type {
  DashboardSummaryResponse,
  DashboardSummaryTrendResponse,
  DashboardSummaryTrendPoint,
} from '@app/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';
import { BarChart, ChartContainer, DonutChart, GaugeChart, Sparkline } from '../components/charts';
import { DashboardSkeleton } from '../components/patterns/DashboardSkeleton';
import { EmptyState } from '../components/patterns/empty-state';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { SafeComponent } from '../components/errors/safe-component';
import { createApiClient } from '../lib/api-client';
import { getSessionAuthHeaders } from '../lib/session-auth';
import { apiLoader, createLoaderApiClient, type LoaderData } from '../utils/loaders';
import { ActivityTimeline } from './dashboard/components/ActivityTimeline';
import { QuickActionsPanel } from './dashboard/components/QuickActionsPanel';
import { SystemAlertsBanner } from './dashboard/components/SystemAlertsBanner';
import { jobsStore } from '../contexts/jobs-context.js';

const api = createApiClient({ getAuthHeaders: getSessionAuthHeaders });

export const loader = apiLoader(async (_args: LoaderFunctionArgs) => {
  const api = createLoaderApiClient();
  return {
    summary: await api.getApi<DashboardSummaryResponse>('/dashboard/summary'),
  };
});

type RouteLoaderData = LoaderData<typeof loader>;

interface Kpi {
  key: string;
  title: string;
  value: string;
  numericValue?: number;
  format?: (n: number) => string;
  subtext: string;
  trend: number;
  trendSeries: number[];
  icon: ComponentType<{ className?: string }>;
  tooltip: string;
  onClick?: () => void;
}

function KpiCountUp({ value, format }: { value: number; format: (n: number) => string }) {
  return <>{useCountUp(value, { format })}</>;
}

const KPI_ICON_COLORS: Record<string, string> = {
  'total-products': 'icon-primary',
  'active-bulk-runs': 'icon-chart3',
  'api-error-rate': 'icon-error',
  'api-latency': 'icon-warning',
  'golden-rate': 'icon-golden',
  'quality-score': 'icon-success',
  'queue-backlog': 'icon-chart4',
  'enrichment-success': 'icon-chart5',
  'ai-costs-today': 'icon-chart7',
  'webhooks-today': 'icon-accent',
  'attention-products': 'icon-warning',
};

export default function DashboardIndex() {
  const { summary } = useLoaderData<RouteLoaderData>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();
  const [refreshing, setRefreshing] = useState(false);
  const [globalRange, setGlobalRange] = useState<'azi' | '7z' | '30z'>('7z');
  const rangeDays = globalRange === 'azi' ? 1 : globalRange === '30z' ? 30 : 7;
  const go = useCallback(
    (to: string) => {
      void navigate(to);
    },
    [navigate]
  );
  const numberFormatter = new Intl.NumberFormat('ro-RO');
  const percentFormatter = new Intl.NumberFormat('ro-RO', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const currencyFormatter = new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const qualityBreakdown = useQuery({
    queryKey: ['dashboard', 'quality-breakdown'],
    queryFn: () => api.getApi<Record<string, unknown>>('/pim/stats/quality-distribution'),
    staleTime: 60_000,
  });
  const apiUsage = useQuery({
    queryKey: ['dashboard', 'api-usage'],
    queryFn: () => api.getApi<Record<string, unknown>>('/pim/stats/cost-tracking'),
    staleTime: 60_000,
  });
  const queuesSummary = useQuery({
    queryKey: ['dashboard', 'queues-summary'],
    queryFn: () => api.getApi<Record<string, unknown>>('/queues'),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const activityDay = useQuery({
    queryKey: ['dashboard', 'activity-day'],
    queryFn: () => api.getApi<Record<string, unknown>>('/dashboard/activity?days=1'),
    staleTime: 30_000,
  });
  const currentBulk = useQuery({
    queryKey: ['dashboard', 'bulk-current'],
    queryFn: () => api.getApi<Record<string, unknown> | null>('/bulk/current'),
    staleTime: 30_000,
  });
  const productsAttention = useQuery({
    queryKey: ['dashboard', 'products-needing-enrichment'],
    queryFn: () => api.getApi<Record<string, unknown>>('/pim/stats/enrichment-progress'),
    staleTime: 60_000,
  });
  const recentRuns = useQuery({
    queryKey: ['dashboard', 'recent-runs'],
    queryFn: () => api.getApi<Record<string, unknown>>('/bulk?limit=8'),
    staleTime: 45_000,
  });
  const enrichmentStatus = useQuery({
    queryKey: ['dashboard', 'enrichment-status'],
    queryFn: () => api.getApi<Record<string, unknown>>('/pim/stats/enrichment-progress'),
    staleTime: 60_000,
  });
  const healthScoreQuery = useQuery({
    queryKey: ['dashboard', 'health-score'],
    queryFn: () =>
      api.getApi<{ score: number; status: string; components: Record<string, unknown> }>(
        '/dashboard/health-score'
      ),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const trendQuery = useQuery({
    queryKey: ['dashboard', 'summary-trend', rangeDays],
    queryFn: () =>
      api.getApi<DashboardSummaryTrendResponse>(`/dashboard/summary/trend?days=${rangeDays}`),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const trendPoints = trendQuery.data?.points ?? [];

  const qualityValues = useMemo(() => {
    if (
      summary.goldenCount !== undefined &&
      summary.goldenRate !== undefined &&
      summary.avgQualityScore !== undefined
    ) {
      const goldenCount = summary.goldenCount;
      const goldenRate = summary.goldenRate;
      const avgQualityScore = summary.avgQualityScore;
      const total =
        goldenRate > 0 ? Math.round(goldenCount / goldenRate) : Math.max(1, summary.totalProducts);
      const silver = Math.round(total * 0.3);
      const bronze = Math.round(total * 0.15);
      const review = total - goldenCount - silver - bronze;
      return {
        golden: goldenCount,
        silver,
        bronze,
        review: Math.max(0, review),
        total,
        goldenRate,
        avgQualityScore,
      };
    }

    const payload = qualityBreakdown.data ?? {};
    const findNumber = (keys: string[]) => {
      for (const key of keys) {
        const value = payload[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
      }
      return 0;
    };
    const golden = findNumber(['golden', 'goldenCount', 'golden_count']);
    const silver = findNumber(['silver', 'silverCount', 'silver_count']);
    const bronze = findNumber(['bronze', 'bronzeCount', 'bronze_count']);
    const review = findNumber(['review', 'reviewCount', 'review_count']);
    const total = Math.max(1, golden + silver + bronze + review);
    const goldenRate = golden / total;
    const avgQualityScore =
      findNumber(['avgQualityScore', 'averageScore', 'qualityScore']) ||
      (golden * 1 + silver * 0.66 + bronze * 0.33 + review * 0.5) / total;
    return { golden, silver, bronze, review, total, goldenRate, avgQualityScore };
  }, [qualityBreakdown.data, summary]);

  const aiCostsToday = useMemo(() => {
    if (typeof summary.todayAiCost === 'number' && summary.todayAiCost > 0)
      return summary.todayAiCost;
    const payload = apiUsage.data ?? {};
    for (const key of ['todayCost', 'today', 'todayUsd', 'costToday', 'totalToday']) {
      const value = payload[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return 0;
  }, [apiUsage.data, summary.todayAiCost]);

  const queueBacklog = useMemo(() => {
    if (typeof summary.queueBacklog === 'number') return summary.queueBacklog;
    const payload = queuesSummary.data ?? {};
    const queues = Array.isArray(payload['queues'])
      ? (payload['queues'] as Record<string, unknown>[])
      : [];
    return queues.reduce((acc, queue) => {
      const counts = (queue['counts'] ?? {}) as Record<string, unknown>;
      const waiting =
        (typeof queue['waiting'] === 'number' ? queue['waiting'] : 0) +
        (typeof counts['waiting'] === 'number' ? counts['waiting'] : 0);
      const delayed =
        (typeof queue['delayed'] === 'number' ? queue['delayed'] : 0) +
        (typeof counts['delayed'] === 'number' ? counts['delayed'] : 0);
      return acc + waiting + delayed;
    }, 0);
  }, [queuesSummary.data, summary.queueBacklog]);

  const webhooksToday = useMemo(() => {
    if (typeof summary.todayWebhooks === 'number') return summary.todayWebhooks;
    const pointsRaw = (activityDay.data?.['points'] ?? []) as Record<string, unknown>[];
    const first = pointsRaw[0];
    if (!first) return 0;
    const breakdown = (first['breakdown'] ?? {}) as Record<string, unknown>;
    return typeof breakdown['webhook'] === 'number' ? breakdown['webhook'] : 0;
  }, [activityDay.data, summary.todayWebhooks]);

  const attentionCount = useMemo(() => {
    const payload = productsAttention.data ?? {};
    for (const key of ['total', 'count', 'pending', 'products', 'needsEnrichment']) {
      const value = payload[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return 0;
  }, [productsAttention.data]);
  const enrichmentSuccessRate = useMemo(() => {
    if (typeof summary.enrichmentSuccessRate === 'number') return summary.enrichmentSuccessRate;
    const payload = enrichmentStatus.data ?? {};
    for (const key of ['successRate', 'success_rate', 'rate']) {
      const value = payload[key];
      if (typeof value === 'number' && Number.isFinite(value))
        return value > 1 ? value / 100 : value;
    }
    return 0;
  }, [enrichmentStatus.data, summary.enrichmentSuccessRate]);
  const healthScore = useMemo(() => {
    if (healthScoreQuery.data?.score !== undefined) return healthScoreQuery.data.score;
    const latencyScore =
      summary.apiLatencyP95Ms == null
        ? 50
        : Math.max(0, Math.min(100, 100 - summary.apiLatencyP95Ms / 30));
    const errorScore =
      summary.apiErrorRate == null
        ? 50
        : Math.max(0, Math.min(100, 100 - summary.apiErrorRate * 1500));
    const backlogScore = Math.max(0, Math.min(100, 100 - queueBacklog / 15));
    return Math.round((latencyScore + errorScore + backlogScore) / 3);
  }, [queueBacklog, summary.apiErrorRate, summary.apiLatencyP95Ms, healthScoreQuery.data]);
  const healthStatus =
    healthScoreQuery.data?.status ??
    (healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'degraded' : 'critical');
  const recentRunsItems = useMemo(() => {
    const payload = recentRuns.data ?? {};
    const runs = Array.isArray(payload['runs'])
      ? (payload['runs'] as Record<string, unknown>[])
      : [];
    return runs.slice(0, 6).map((run) => {
      const runIdRaw = run['id'] ?? run['run_id'];
      const statusRaw = run['status'];
      return {
        id:
          typeof runIdRaw === 'string'
            ? runIdRaw
            : typeof runIdRaw === 'number'
              ? `${runIdRaw}`
              : 'run',
        status:
          typeof statusRaw === 'string'
            ? statusRaw
            : typeof statusRaw === 'number'
              ? `${statusRaw}`
              : 'unknown',
        startedAt: typeof run['started_at'] === 'string' ? run['started_at'] : null,
      };
    });
  }, [recentRuns.data]);
  const dashboardWidgetsLoading =
    qualityBreakdown.isLoading ||
    queuesSummary.isLoading ||
    apiUsage.isLoading ||
    enrichmentStatus.isLoading;

  const [kpiSectionRef, kpiSectionVisible] = useScrollReveal<HTMLElement>({
    rootMargin: '0px 0px -40px 0px',
  });

  const refreshAll = useCallback(() => {
    if (refreshing || revalidator.state === 'loading') return;
    setRefreshing(true);
    const jobId = `dashboard-refresh-${Date.now()}`;
    jobsStore.add({
      id: jobId,
      label: 'Reîncărcare date dashboard',
      status: 'running',
      progress: 0,
      startedAt: Date.now(),
    });

    void revalidator.revalidate();

    void queryClient
      .refetchQueries({ queryKey: ['dashboard'], type: 'active' })
      .then(() => {
        jobsStore.update(jobId, { status: 'completed', progress: 100 });
        setTimeout(() => jobsStore.remove(jobId), 3000);
      })
      .catch((err: unknown) => {
        jobsStore.update(jobId, { status: 'failed' });
        toast.error(err instanceof Error ? err.message : 'Reîncărcarea a eșuat');
      })
      .finally(() => {
        setRefreshing(false);
      });
  }, [queryClient, refreshing, revalidator]);

  const trendSeries = useCallback(
    (field: keyof DashboardSummaryTrendPoint, fallback: number[]): number[] => {
      if (trendPoints.length === 0) return fallback;
      return trendPoints.map((p) => Number(p[field]));
    },
    [trendPoints]
  );

  const kpis: Kpi[] = [
    {
      key: 'total-products',
      title: 'Produse Totale',
      value: numberFormatter.format(summary.totalProducts),
      numericValue: summary.totalProducts,
      format: (n) => numberFormatter.format(n),
      subtext: 'Total produse în Shopify mirror',
      trend: Math.min(24, Math.max(-24, summary.totalProducts / 120)),
      trendSeries: trendSeries('totalProducts', [
        Math.max(0, summary.totalProducts - 190),
        summary.totalProducts - 72,
        summary.totalProducts,
      ]),
      icon: Package,
      onClick: () => go('/products'),
      tooltip:
        'CE ESTE: Numărul total de produse sincronizate din magazinul tău Shopify. DE CE CONTEAZĂ: Reflectă dimensiunea catalogului gestionat de Neanelu — cu cât sunt mai multe, cu atât enrichment-ul AI și calitatea datelor devin mai importante. EXEMPLU: Dacă ai 5.000 produse în Shopify dar vezi doar 3.200 aici, trebuie să rulezi o ingestie completă. SFAT: Folosește pagina Ingestion pentru sincronizare completă.',
    },
    {
      key: 'active-bulk-runs',
      title: 'Procese Active',
      value: numberFormatter.format(summary.activeBulkRuns),
      numericValue: summary.activeBulkRuns,
      format: (n) => numberFormatter.format(n),
      subtext: 'Bulk runs în status pending/running',
      trend: Math.min(18, Math.max(-18, summary.activeBulkRuns * 2)),
      trendSeries: [
        Math.max(0, summary.activeBulkRuns - 2),
        summary.activeBulkRuns + 1,
        summary.activeBulkRuns,
      ],

      icon: Cpu,
      onClick: () => go('/queues'),
      tooltip:
        'CE ESTE: Rulări de ingestie în masă (bulk) în curs sau în așteptare. DE CE CONTEAZĂ: Procesele active consumă resurse și pot afecta performanța altor operații. Dacă e 0, nu rulează nicio sincronizare bulk. EXEMPLU: „3 procese active" înseamnă că se importă sau actualizează produse în paralel. SFAT: Verifică pagina Cozi pentru detalii și control.',
    },
    {
      key: 'api-error-rate',
      title: 'Rata Erori API',
      value: summary.apiErrorRate != null ? percentFormatter.format(summary.apiErrorRate) : 'N/A',
      subtext: 'Ultimele 24h',
      trend: summary.apiErrorRate != null ? -Math.round(summary.apiErrorRate * 120) : 0,
      trendSeries: trendSeries('apiErrorRate', [
        Math.max(0, (summary.apiErrorRate ?? 0) * 1.35),
        Math.max(0, (summary.apiErrorRate ?? 0) * 1.1),
        Math.max(0, summary.apiErrorRate ?? 0),
      ]),
      icon: AlertTriangle,
      onClick: () => go('/settings/api'),
      tooltip:
        'CE ESTE: Procentul de cereri API care au eșuat în ultimele 24h. DE CE CONTEAZĂ: O rată aproape de 0% înseamnă stabilitate. Peste 5% indică probleme cu Shopify sau serviciile AI. EXEMPLU: Rata de 2.3% din 1.000 cereri = 23 erori — de obicei temporare. SFAT: „N/A" apare când nu au existat cereri. Verifică Setări API pentru detalii.',
    },
    {
      key: 'api-latency',
      title: 'API Latency p95',
      value: summary.apiLatencyP95Ms != null ? `${Math.round(summary.apiLatencyP95Ms)} ms` : 'N/A',
      subtext: 'Ultimele 24h',
      trend:
        summary.apiLatencyP95Ms != null ? -Math.round((summary.apiLatencyP95Ms - 500) / 100) : 0,
      trendSeries: [
        Math.max(1, (summary.apiLatencyP95Ms ?? 1000) + 260),
        Math.max(1, (summary.apiLatencyP95Ms ?? 1000) + 130),
        Math.max(1, summary.apiLatencyP95Ms ?? 1000),
      ],

      icon: Activity,
      onClick: () => go('/settings/api'),
      tooltip:
        'CE ESTE: Timpul de răspuns la percentila 95 — 95% din cereri sunt mai rapide. DE CE CONTEAZĂ: Sub 500ms e excelent, 500–2000ms acceptabil, peste 2000ms e problematic. EXEMPLU: p95=800ms înseamnă că doar 5% din cereri durează mai mult de 0.8s. SFAT: Dacă crește constant, verifică Redis și conexiunea la Shopify.',
    },
    {
      key: 'golden-rate',
      title: 'Rată Golden',
      value: percentFormatter.format(qualityValues.goldenRate),
      subtext: `${numberFormatter.format(qualityValues.golden)} produse Golden`,
      trend: Math.round(qualityValues.goldenRate * 32),
      trendSeries: trendSeries('goldenRate', [
        qualityValues.goldenRate * 0.9,
        qualityValues.goldenRate * 0.95,
        qualityValues.goldenRate,
      ]),
      icon: Layers,
      onClick: () => go('/pim/quality'),
      tooltip:
        'CE ESTE: Procentul produselor clasificate Golden Record — date complete și validate. DE CE CONTEAZĂ: Un procent mai mare = catalog mai curat, produse prioritare pentru promovare. EXEMPLU: 68% Golden din 5.000 produse = 3.400 cu date complete. SFAT: Rulează enrichment pe produsele Bronze pentru a le ridica la Golden.',
    },
    {
      key: 'quality-score',
      title: 'Scor Calitate',
      value: `${Math.max(0, Math.min(10, qualityValues.avgQualityScore * 10)).toFixed(1)} / 10`,
      subtext: 'Calitate medie a catalogului',
      trend: Math.round(qualityValues.avgQualityScore * 20),
      trendSeries: trendSeries('avgQualityScore', [
        qualityValues.avgQualityScore * 8.5,
        qualityValues.avgQualityScore * 9.2,
        qualityValues.avgQualityScore * 10,
      ]),
      icon: Brain,
      onClick: () => go('/pim/quality'),
      tooltip:
        'CE ESTE: Scor mediu de calitate (0–10) calculat din toate nivelurile de produs. DE CE CONTEAZĂ: Indică cât de complete și consistente sunt datele catalogului. EXEMPLU: Scor 7.2/10 e bun, sub 5/10 necesită atenție urgentă. SFAT: Pagina Calitate oferă filtrare per nivel și recomandări de îmbunătățire.',
    },
    {
      key: 'queue-backlog',
      title: 'Backlog Coadă',
      value: numberFormatter.format(queueBacklog),
      numericValue: queueBacklog,
      format: (n) => numberFormatter.format(n),
      subtext: 'Job-uri în așteptare + întârziate',
      trend: queueBacklog > 1000 ? -12 : queueBacklog > 300 ? -4 : 7,
      trendSeries: trendSeries('queueBacklog', [
        Math.max(0, queueBacklog + 110),
        Math.max(0, queueBacklog + 40),
        queueBacklog,
      ]),
      icon: Cpu,
      onClick: () => go('/queues'),
      tooltip:
        'CE ESTE: Total job-uri waiting + delayed din toate cozile. DE CE CONTEAZĂ: Un backlog mare indică încetinire sau necesitatea de workeri suplimentari. EXEMPLU: 500 job-uri în backlog se rezolvă de obicei în 10–15 minute. SFAT: Pagina Cozi oferă detalii per coadă și opțiuni de control.',
    },
    {
      key: 'enrichment-success',
      title: 'Rata Enrichment',
      value: percentFormatter.format(enrichmentSuccessRate),
      subtext: 'Succes proces enrichment',
      trend: Math.round(enrichmentSuccessRate * 18),
      trendSeries: trendSeries('enrichmentSuccessRate', [
        enrichmentSuccessRate * 0.8,
        enrichmentSuccessRate * 0.9,
        enrichmentSuccessRate,
      ]),
      icon: Layers,
      onClick: () => go('/pim/enrichment'),
      tooltip:
        'CE ESTE: Procentul operațiunilor de îmbogățire AI finalizate cu succes. DE CE CONTEAZĂ: O rată scăzută indică probleme cu furnizorii AI sau date sursă incomplete. EXEMPLU: 92% succes din 200 operații = 184 reușite, 16 eșuate. SFAT: Verifică paginile Enrichment și Costuri pentru detalii pe sursă.',
    },
    {
      key: 'ai-costs-today',
      title: 'Costuri AI Azi',
      value: currencyFormatter.format(aiCostsToday),
      subtext: 'OpenAI + xAI + Serper + Scraper',
      trend: aiCostsToday > 0 ? -Math.min(15, Math.round(aiCostsToday)) : 0,
      trendSeries: trendSeries('todayAiCost', [
        Math.max(0, aiCostsToday * 0.6),
        Math.max(0, aiCostsToday * 0.8),
        aiCostsToday,
      ]),
      icon: Brain,
      onClick: () => go('/pim/costs'),
      tooltip:
        'CE ESTE: Costul total USD pentru serviciile AI astăzi. DE CE CONTEAZĂ: Monitorizează consumul zilnic pentru a evita depășirea bugetului. EXEMPLU: $12.50 azi din limita de $50 = 25% consumat. SFAT: Pagina Costuri oferă breakdown pe provider și setare limite.',
    },
    {
      key: 'webhooks-today',
      title: 'Webhooks Azi',
      value: numberFormatter.format(webhooksToday),
      subtext: 'Notificări Shopify procesate',
      trend: webhooksToday > 0 ? 9 : 0,
      trendSeries: [
        Math.max(0, webhooksToday - 140),
        Math.max(0, webhooksToday - 45),
        webhooksToday,
      ],

      icon: Webhook,
      onClick: () => go('/settings/webhooks'),
      tooltip:
        'CE ESTE: Notificări Shopify procesate astăzi (produse create, actualizate, șterse). DE CE CONTEAZĂ: Un număr mare e normal pentru magazine active. Dacă e 0 dar ai activitate, verifică conexiunea. EXEMPLU: 350 webhooks azi = 350 de modificări din Shopify procesate automat. SFAT: Verifică Setări Webhooks dacă notificările nu ajung.',
    },
    {
      key: 'last-sync',
      title: 'Ultima Sincronizare',
      value:
        summary.lastSyncAt && typeof summary.lastSyncAt === 'string'
          ? new Date(summary.lastSyncAt).toLocaleString('ro-RO')
          : currentBulk.data && typeof currentBulk.data['started_at'] === 'string'
            ? new Date(currentBulk.data['started_at']).toLocaleString('ro-RO')
            : 'N/A',
      subtext: summary.lastSyncStatus
        ? `Status: ${summary.lastSyncStatus}`
        : 'Ultimul bulk run observat',
      trend: summary.lastSyncAt || currentBulk.data ? 5 : -5,
      trendSeries: [1, 2, 3],
      icon: RefreshCw,
      onClick: () => go('/ingestion/history'),
      tooltip:
        'CE ESTE: Data și ora ultimei sincronizări complete din Shopify. DE CE CONTEAZĂ: Arată cât de proaspete sunt datele din catalog. EXEMPLU: „Acum 2 ore" e OK, „Acum 3 zile" poate indica o problemă. SFAT: Programează sincronizări automate din pagina Ingestion.',
    },
  ];
  const qualityDonutData = [
    { name: 'Golden', value: qualityValues.golden, color: 'rgb(var(--color-golden))' },
    { name: 'Silver', value: qualityValues.silver, color: 'rgb(var(--color-silver))' },
    { name: 'Bronze', value: qualityValues.bronze, color: 'rgb(var(--color-bronze))' },
    { name: 'Review', value: qualityValues.review, color: 'rgb(var(--color-review))' },
  ];
  const queueBars = useMemo(() => {
    const payload = queuesSummary.data ?? {};
    const queues = Array.isArray(payload['queues'])
      ? (payload['queues'] as Record<string, unknown>[])
      : [];
    return queues.slice(0, 6).map((queue) => {
      const counts = (queue['counts'] ?? {}) as Record<string, unknown>;
      return {
        name:
          typeof queue['name'] === 'string'
            ? queue['name']
            : typeof queue['name'] === 'number'
              ? `${queue['name']}`
              : 'queue',
        waiting:
          (typeof queue['waiting'] === 'number' ? queue['waiting'] : 0) +
          (typeof counts['waiting'] === 'number' ? counts['waiting'] : 0),
        active:
          (typeof queue['active'] === 'number' ? queue['active'] : 0) +
          (typeof counts['active'] === 'number' ? counts['active'] : 0),
        failed:
          (typeof queue['failed'] === 'number' ? queue['failed'] : 0) +
          (typeof counts['failed'] === 'number' ? counts['failed'] : 0),
      };
    });
  }, [queuesSummary.data]);
  const costsBarData = useMemo(() => {
    const payload = apiUsage.data ?? {};
    const providers = (payload['providers'] ?? payload['byProvider'] ?? {}) as Record<
      string,
      unknown
    >;
    if (providers && typeof providers === 'object' && Object.keys(providers).length > 0) {
      return Object.entries(providers).map(([name, value]) => ({
        provider: name,
        cost: typeof value === 'number' ? value : 0,
      }));
    }
    return [
      { provider: 'OpenAI', cost: 0 },
      { provider: 'xAI', cost: 0 },
      { provider: 'Serper', cost: 0 },
      { provider: 'Scraper', cost: 0 },
    ];
  }, [apiUsage.data]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 py-4 sm:border-none sm:bg-transparent sm:px-0 sm:py-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground motion-safe:animate-[fadeSlideUp_0.5s_ease-out_both]">
            <span className="sidebar-logo">
              {new Date().getHours() < 12
                ? 'Bună dimineața'
                : new Date().getHours() < 18
                  ? 'Bună ziua'
                  : 'Bună seara'}
            </span>
            {', Admin'}
          </h1>
          <p className="mt-1 text-sm text-muted motion-safe:animate-[fadeSlideUp_0.5s_ease-out_0.1s_both]">
            Ai {numberFormatter.format(summary.activeBulkRuns)} procese active.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5">
            <Select
              value={globalRange}
              options={[
                { value: 'azi', label: 'Azi' },
                { value: '7z', label: 'Ultimele 7 zile' },
                { value: '30z', label: 'Ultimele 30 zile' },
              ]}
              onChange={(event) => setGlobalRange(event.target.value as 'azi' | '7z' | '30z')}
              aria-label="Interval global dashboard"
            />
            <InfoTooltip title="Interval date" side="bottom">
              CE ESTE: Selectorul de perioadă pentru grafice și tendințe. DE CE CONTEAZĂ: Permite
              analiza pe termen scurt (azi) sau mediu (7/30 zile). EXEMPLU: „Ultimele 7 zile" arată
              tendințele din ultima săptămână. SFAT: Unele KPI-uri (produse totale, procese active)
              nu depind de interval.
            </InfoTooltip>
          </span>
          <Button
            variant="secondary"
            disabled={refreshing || revalidator.state === 'loading'}
            onClick={refreshAll}
            className="transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] active:translate-y-0"
          >
            <span className="inline-flex items-center gap-2">
              <RefreshCw
                className={`size-4 transition-transform duration-500 ${
                  refreshing || revalidator.state === 'loading' ? 'animate-spin' : ''
                }`}
              />
              {refreshing || revalidator.state === 'loading' ? 'Se reîncarcă…' : 'Reîncarcă datele'}
            </span>
          </Button>
          <InfoTooltip title="Reîncarcă datele" side="bottom">
            CE ESTE: Buton de reîmprospătare a tuturor datelor afișate. DE CE CONTEAZĂ: Actualizează
            KPI-uri, grafice, alerte și timeline fără refresh complet. EXEMPLU: Apasă după ce faci
            modificări în Shopify pentru a vedea impactul imediat. SFAT: Datele se actualizează
            automat la fiecare 30–60 secunde.
          </InfoTooltip>
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-success/50 animate-[queueLivePulse_1.5s_ease-in-out_infinite]" />
            Live
          </span>
        </div>
      </header>

      <SafeComponent>
        {summary.totalProducts === 0 ? (
          <EmptyState
            icon={Package}
            title="Nu există produse sincronizate încă"
            description="Importă primele produse din Shopify pentru a vedea indicatori, grafice și recomandări în dashboard."
            actionLabel="Deschide Ingestie"
            onAction={() => go('/ingestion')}
          />
        ) : (
          <>
            <SystemAlertsBanner />

            <div className="dashboard-bento">
              <section
                ref={kpiSectionRef}
                aria-labelledby="dashboard-kpis-heading"
                className="bento-kpis grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5"
              >
                <h2 id="dashboard-kpis-heading" className="sr-only">
                  Indicatori cheie
                </h2>
                {kpis.map((kpi, index) => {
                  const Icon = kpi.icon;
                  const displayValue =
                    kpi.numericValue != null && kpi.format ? (
                      <KpiCountUp
                        key={`countup-${kpi.key}`}
                        value={kpi.numericValue}
                        format={kpi.format}
                      />
                    ) : (
                      kpi.value
                    );

                  return (
                    <article
                      key={kpi.key}
                      className="kpi-card-enterprise group/kpi overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] backdrop-blur-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:border-primary/40 hover:shadow-[var(--shadow-md)] focus-within:ring-2 focus-within:ring-ring/20 focus-within:ring-offset-2"
                      style={
                        reducedMotion
                          ? undefined
                          : {
                              animation: kpiSectionVisible
                                ? `fadeSlideUp 0.4s ease-out ${index * 80}ms both`
                                : 'none',
                            }
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                            {kpi.title}
                            <InfoTooltip title={kpi.title}>{kpi.tooltip}</InfoTooltip>
                          </div>
                          <p className="mt-1.5 text-2xl font-extrabold tabular-nums text-foreground transition-colors duration-normal group-hover/kpi:text-primary">
                            {displayValue}
                          </p>
                          <div className="mt-2 flex items-center gap-2 text-[11px]">
                            <span
                              className={`inline-flex items-center gap-0.5 font-semibold ${
                                kpi.trend >= 0 ? 'text-success' : 'text-error'
                              }`}
                            >
                              {kpi.trend >= 0 ? (
                                <ArrowUpRight className="size-3" />
                              ) : (
                                <ArrowDownRight className="size-3" />
                              )}
                              {Math.abs(kpi.trend)}%
                            </span>
                            <Sparkline
                              data={kpi.trendSeries.map((value) => Number(value))}
                              color={
                                kpi.trend >= 0
                                  ? 'rgb(var(--color-success))'
                                  : 'rgb(var(--color-error))'
                              }
                            />
                          </div>
                        </div>
                        <div
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all duration-300 group-hover/kpi:scale-110 ${KPI_ICON_COLORS[kpi.key] ?? 'icon-primary'}`}
                        >
                          <Icon className="size-5" />
                        </div>
                      </div>
                      <button
                        type="button"
                        className="mt-3 w-full text-left text-xs text-muted transition-colors duration-fast hover:text-primary"
                        onClick={kpi.onClick}
                      >
                        {kpi.subtext}
                      </button>
                    </article>
                  );
                })}
              </section>

              {dashboardWidgetsLoading ? (
                <DashboardSkeleton columns={3} rows={1} variant="chart" />
              ) : (
                <>
                  <div className="bento-quality">
                    <ChartContainer
                      title="Distribuție calitate"
                      description="Bronze / Silver / Golden / Review"
                      height={220}
                    >
                      <DonutChart
                        data={qualityDonutData}
                        centerLabel={numberFormatter.format(qualityValues.total)}
                        onSliceClick={() => {
                          go('/pim/quality');
                        }}
                      />
                    </ChartContainer>
                  </div>
                  <div className="bento-queues">
                    <ChartContainer
                      title="Status cozi"
                      description="Top cozi după încărcare"
                      height={220}
                    >
                      <BarChart
                        data={queueBars}
                        xAxisKey="name"
                        bars={[
                          {
                            dataKey: 'waiting',
                            name: 'Waiting',
                            color: 'rgb(var(--color-warning))',
                            stackId: 'q',
                          },
                          {
                            dataKey: 'active',
                            name: 'Active',
                            color: 'rgb(var(--color-primary))',
                            stackId: 'q',
                          },
                          {
                            dataKey: 'failed',
                            name: 'Failed',
                            color: 'rgb(var(--color-error))',
                            stackId: 'q',
                          },
                        ]}
                        stacked
                      />
                    </ChartContainer>
                  </div>
                  <article className="bento-attention overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] backdrop-blur-sm">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
                      Produse ce necesită atenție
                      <InfoTooltip title="Produse ce necesită atenție" side="bottom">
                        CE ESTE: Produse cu date incomplete, în review sau care așteaptă îmbogățire
                        AI. DE CE CONTEAZĂ: Aceste produse ar putea fi afișate greșit în magazin sau
                        ar pierde oportunități de vânzare. EXEMPLU: 45 produse fără descriere sau
                        imagini optimizate. SFAT: Click pe „Vezi produse" pentru a le filtra și
                        prioritiza în pagina Calitate.
                      </InfoTooltip>
                    </h3>
                    <p className="mt-0.5 text-xs text-muted">
                      Produse cu date incomplete sau în review
                    </p>
                    <p className="mt-3 text-2xl font-bold text-foreground tabular-nums">
                      <KpiCountUp
                        value={attentionCount}
                        format={(n) => numberFormatter.format(n)}
                      />
                    </p>
                    <div className="mt-3 flex items-center gap-1.5">
                      <Button
                        className="flex-1"
                        variant="secondary"
                        onClick={() => go('/pim/quality')}
                      >
                        Vezi produse
                      </Button>
                      <InfoTooltip title="Vezi produse" side="bottom">
                        CE ESTE: Navigare directă la pagina Calitate cu filtre active. DE CE
                        CONTEAZĂ: Oferă acces rapid la produsele ce necesită revizuire manuală sau
                        enrichment. EXEMPLU: Vei vedea lista filtrată cu toate produsele incomplete.
                        SFAT: Poți trimite produsele direct la enrichment din acea pagină.
                      </InfoTooltip>
                    </div>
                  </article>
                </>
              )}

              <div className="bento-costs">
                <ChartContainer
                  title="Costuri API pe provider"
                  description="Ziua curentă"
                  height={220}
                >
                  <BarChart
                    data={costsBarData}
                    xAxisKey="provider"
                    bars={[
                      { dataKey: 'cost', name: 'Cost USD', color: 'rgb(var(--color-accent))' },
                    ]}
                  />
                </ChartContainer>
              </div>
              <article className="bento-budget overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] backdrop-blur-sm">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
                  Buget AI azi
                  <InfoTooltip title="Buget AI azi" side="bottom">
                    CE ESTE: Gauge-ul consumului curent în USD pentru serviciile AI. DE CE CONTEAZĂ:
                    Galben indică 70% din buget consumat, roșu peste 90%. Depășirea bugetului poate
                    opri automat enrichment-ul. EXEMPLU: $35 din $50 limită = zonă galbenă,
                    reducerea operațiilor e recomandată. SFAT: Configurează limite și alerte în
                    pagina Costuri.
                  </InfoTooltip>
                </h3>
                <p className="mt-0.5 text-xs text-muted">Consum curent și acțiune rapidă</p>
                <div className="mt-3 flex items-center justify-center">
                  <GaugeChart
                    value={aiCostsToday}
                    min={0}
                    max={50}
                    thresholds={[
                      { value: 35, color: 'rgb(var(--color-warning))' },
                      { value: 45, color: 'rgb(var(--color-error))' },
                    ]}
                    label="USD"
                    formatValue={(value) => currencyFormatter.format(value)}
                  />
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  <Button className="flex-1" variant="secondary" onClick={() => go('/pim/costs')}>
                    Vezi costuri detaliate
                  </Button>
                  <InfoTooltip title="Vezi costuri detaliate" side="bottom">
                    CE ESTE: Link direct la pagina de management costuri AI. DE CE CONTEAZĂ: Permite
                    vizualizarea breakdown-ului pe provider, configurarea limitelor zilnice și
                    pragurilor de alertă. EXEMPLU: Poți vedea că OpenAI consumă 60% din buget iar
                    Serper doar 5%. SFAT: Pune cozile pe pauză automat când bugetul e depășit.
                  </InfoTooltip>
                </div>
              </article>

              <article className="bento-qhealth overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] backdrop-blur-sm">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
                  Queue Health
                  <InfoTooltip title="Queue Health" side="bottom">
                    CE ESTE: Starea rapidă a cozilor principale de procesare. DE CE CONTEAZĂ: Arată
                    câte job-uri așteaptă în fiecare coadă. Dacă o coadă crește constant, indică o
                    problemă. EXEMPLU: „webhook-queue: 12" = 12 notificări Shopify în așteptare.
                    SFAT: Pagina Cozi oferă control complet.
                  </InfoTooltip>
                </h3>
                <p className="mt-0.5 text-xs text-muted">Stare rapidă pe cozi</p>
                <div className="mt-3 space-y-2">
                  {queueBars.slice(0, 4).map((queue) => (
                    <div
                      key={queue.name}
                      className="flex items-center justify-between rounded-md bg-subtle/40 px-2 py-1.5"
                    >
                      <span className="truncate text-xs text-muted">{queue.name}</span>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-success/50 motion-safe:animate-[queueLivePulse_1.5s_ease-in-out_infinite]" />
                        {queue.waiting}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 border-t border-border pt-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Pipeline PIM
                    <InfoTooltip title="Pipeline PIM" side="bottom">
                      CE ESTE: Distribuția produselor pe niveluri de calitate (Raw → Bronze → Silver
                      → Golden). DE CE CONTEAZĂ: Vizualizează progresul catalogului spre date
                      complete. EXEMPLU: 40% Golden, 30% Silver = catalogul e pe drumul cel bun.
                      SFAT: Obiectivul ideal e peste 70% Golden.
                    </InfoTooltip>
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {(() => {
                      const rawCount = Math.max(
                        0,
                        qualityValues.total -
                          qualityValues.bronze -
                          qualityValues.silver -
                          qualityValues.golden -
                          qualityValues.review
                      );
                      const pipelineLevels: [string, number, string][] = [
                        ['Raw', rawCount, 'rgb(var(--color-muted))'],
                        ['Bronze', qualityValues.bronze, 'rgb(var(--color-bronze))'],
                        ['Silver', qualityValues.silver, 'rgb(var(--color-silver))'],
                        ['Golden', qualityValues.golden, 'rgb(var(--color-golden))'],
                      ];
                      return pipelineLevels.map(([label, value, color], idx) => (
                        <div key={label}>
                          {idx > 0 && (
                            <div className="flex justify-center py-0.5 text-[9px] text-muted">
                              →
                            </div>
                          )}
                          <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted">
                            <span>{label}</span>
                            <span>{numberFormatter.format(value)}</span>
                          </div>
                          <div className="h-1.5 rounded bg-border/40">
                            <div
                              className="h-1.5 rounded transition-all"
                              style={{
                                width: `${Math.min(100, (value / qualityValues.total) * 100)}%`,
                                backgroundColor: color,
                              }}
                            />
                          </div>
                        </div>
                      ));
                    })()}
                    {qualityValues.review > 0 && (
                      <div className="mt-1 border-t border-dashed border-border pt-1">
                        <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted">
                          <span className="flex items-center gap-1">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-review" />
                            Review
                          </span>
                          <span>{numberFormatter.format(qualityValues.review)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </article>

              <article className="bento-events overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] backdrop-blur-sm">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
                  Evenimente recente
                  <InfoTooltip title="Evenimente recente" side="bottom">
                    CE ESTE: Ultimele rulări bulk de sincronizare detectate în sistem. DE CE
                    CONTEAZĂ: Oferă o perspectivă rapidă asupra activității recente de
                    import/sincronizare. EXEMPLU: „run-1234: completed • 14:32" = sincronizare
                    finalizată cu succes. SFAT: Click pe un eveniment pentru istoric complet în
                    pagina Ingestion.
                  </InfoTooltip>
                </h3>
                <p className="mt-0.5 text-xs text-muted">Ultimele rulări bulk detectate</p>
                <div className="mt-3 space-y-2">
                  {recentRunsItems.length === 0 ? (
                    <EmptyState
                      title="Nu există evenimente recente"
                      description="Nicio rulare bulk detectată până acum."
                    />
                  ) : (
                    recentRunsItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="interactive flex w-full items-center justify-between rounded-md border border-border px-2 py-1.5 text-left transition hover:border-accent-border hover:bg-subtle/50"
                        onClick={() => go('/ingestion/history')}
                      >
                        <span className="text-xs font-medium text-foreground">{item.id}</span>
                        <span className="text-xs text-muted">
                          {item.status} •{' '}
                          {item.startedAt
                            ? new Date(item.startedAt).toLocaleString('ro-RO')
                            : 'N/A'}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </article>

              <article className="bento-hscore overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] backdrop-blur-sm">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
                  Health Score
                  <InfoTooltip title="Health Score" side="bottom">
                    CE ESTE: Scor compozit 0–100 al sănătății sistemului, calculat din: Redis (25%),
                    rata erori (25%), latență (25%), backlog (25%). DE CE CONTEAZĂ: Un scor sub 50
                    indică probleme critice ce necesită atenție imediată. EXEMPLU: Scor 85 = sistem
                    sănătos; scor 40 = verifică Redis și cozile. SFAT: Folosește butonul „Check
                    Health" din Acțiuni rapide.
                  </InfoTooltip>
                </h3>
                <p className="mt-0.5 text-xs text-muted">
                  Scor compozit sistem
                  {healthStatus === 'healthy' ? (
                    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                      Sănătos
                    </span>
                  ) : healthStatus === 'degraded' ? (
                    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      Degradat
                    </span>
                  ) : (
                    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-error/15 px-1.5 py-0.5 text-[10px] font-medium text-error">
                      Critic
                    </span>
                  )}
                </p>
                <div className="mt-3 flex justify-center">
                  <GaugeChart
                    value={healthScore}
                    min={0}
                    max={100}
                    thresholds={[
                      { value: 50, color: 'rgb(var(--color-warning))' },
                      { value: 80, color: 'rgb(var(--color-success))' },
                    ]}
                    label="Sănătate"
                  />
                </div>
              </article>

              <div className="bento-timeline motion-safe:animate-[fadeIn_0.5s_ease-out_350ms_both]">
                <ActivityTimeline />
              </div>
              <div className="bento-actions motion-safe:animate-[fadeSlideUp_0.4s_ease-out_450ms_both]">
                <QuickActionsPanel />
              </div>
            </div>
          </>
        )}
      </SafeComponent>
    </div>
  );
}
