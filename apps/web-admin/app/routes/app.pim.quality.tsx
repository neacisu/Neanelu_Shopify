import type { LoaderFunctionArgs } from 'react-router-dom';
import { Link, useLoaderData, useRevalidator, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { RefreshCw, Trophy } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '../components/ui/button';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { QualityDistributionChart } from '../components/domain/QualityDistributionChart';
import { QualityTrendChart } from '../components/domain/QualityTrendChart';
import { PromotionRateCard } from '../components/domain/PromotionRateCard';
import { DataFreshnessIndicator } from '../components/domain/DataFreshnessIndicator';
import { DashboardSkeleton } from '../components/patterns/DashboardSkeleton';
import { useApiClient, useApiRequest } from '../hooks/use-api';
import { useEnrichmentStream } from '../hooks/useEnrichmentStream';
import { apiLoader, createLoaderApiClient, type LoaderData } from '../utils/loaders';

interface QualityDistributionResponse {
  bronze: { count: number; percentage: number; avgQualityScore: number | null };
  silver: { count: number; percentage: number; avgQualityScore: number | null };
  golden: { count: number; percentage: number; avgQualityScore: number | null };
  review: { count: number; percentage: number; avgQualityScore: number | null };
  total: number;
  needsReviewCount: number;
  promotions: {
    toSilver24h: number;
    toGolden24h: number;
    toSilver7d: number;
    toGolden7d: number;
  };
  refreshedAt: string | null;
  trend: { date: string; bronze: number; silver: number; golden: number }[];
  trendRange: { from: string; to: string } | null;
}

interface ProductListItem {
  id: string;
  title: string;
  vendor: string | null;
  qualityScore: number | null;
}

interface ProductsResponse {
  items: ProductListItem[];
  total: number;
}

interface QualityEventsResponse {
  events: {
    id: string;
    eventType: 'quality_promoted' | 'quality_demoted' | 'review_requested' | 'milestone_reached';
    triggerDetails?: Record<string, unknown> | null;
    createdAt: string;
  }[];
}

export const loader = apiLoader(async (_args: LoaderFunctionArgs) => {
  const api = createLoaderApiClient();
  return {
    quality: await api.getApi<QualityDistributionResponse>('/pim/stats/quality-distribution'),
  };
});

type RouteLoaderData = LoaderData<typeof loader>;

export default function QualityProgressPage() {
  const { quality } = useLoaderData<RouteLoaderData>();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const api = useApiClient();
  const stream = useEnrichmentStream();
  const {
    run,
    data: products,
    loading,
  } = useApiRequest((level: string) =>
    api.getApi<ProductsResponse>(
      `/products?qualityLevel=${encodeURIComponent(level)}&sortBy=updated_at&sortOrder=desc`
    )
  );
  const { run: runEvents, data: eventsData } = useApiRequest(() =>
    api.getApi<QualityEventsResponse>('/pim/events/quality?type=milestone_reached&limit=1')
  );
  const selectedLevel = searchParams.get('level');
  const rangeLabel = quality.trendRange
    ? `${new Date(quality.trendRange.from).toLocaleDateString('ro-RO')} → ${new Date(
        quality.trendRange.to
      ).toLocaleDateString('ro-RO')}`
    : undefined;

  useEffect(() => {
    if (!selectedLevel) return;
    void run(selectedLevel).catch(() => undefined);
  }, [selectedLevel, run]);

  useEffect(() => {
    void runEvents().catch(() => undefined);
  }, [runEvents]);

  useEffect(() => {
    const id = setInterval(() => {
      void revalidator.revalidate();
    }, 120_000);
    return () => clearInterval(id);
  }, [revalidator]);

  useEffect(() => {
    for (const evt of stream.events) {
      if (evt.type !== 'quality.event') continue;
      const eventType =
        typeof evt.payload['eventType'] === 'string' ? evt.payload['eventType'] : null;
      const newLevel = typeof evt.payload['newLevel'] === 'string' ? evt.payload['newLevel'] : '';
      if (eventType === 'quality_promoted') {
        toast.success(`Produs promovat la ${newLevel}!`, {
          duration: 5000,
          icon: newLevel === 'golden' ? '🏆' : '⬆️',
        });
      }
      if (eventType === 'quality_demoted') {
        toast.warning(`Produs retrogradat la ${newLevel}`, { duration: 5000 });
      }
      if (eventType === 'milestone_reached') {
        const details = evt.payload['triggerDetails'] as Record<string, unknown> | undefined;
        const milestone = details?.['milestone'];
        const milestoneLabel =
          typeof milestone === 'number'
            ? String(milestone)
            : typeof milestone === 'string'
              ? milestone
              : 'unknown';
        toast.success(`Prag atins: ${milestoneLabel} Golden Records!`, {
          description: 'Programul de calitate a datelor progreseaza.',
          duration: 8000,
          icon: '🏆',
        });
      }
    }
  }, [stream.events]);

  const latestMilestoneEvent = useMemo(() => {
    const loaderEvent = eventsData?.events?.[0];
    const streamEvent = stream.events.find(
      (evt) => evt.type === 'quality.event' && evt.payload['eventType'] === 'milestone_reached'
    );
    if (streamEvent) {
      const details = streamEvent.payload['triggerDetails'] as Record<string, unknown> | undefined;
      return {
        milestone: details?.['milestone'] as number | undefined,
        createdAt: streamEvent.payload['timestamp'] as string | undefined,
      };
    }
    if (loaderEvent) {
      return {
        milestone: loaderEvent.triggerDetails?.['milestone'] as number | undefined,
        createdAt: loaderEvent.createdAt,
      };
    }
    return null;
  }, [eventsData, stream.events]);

  if (revalidator.state === 'loading') {
    return <DashboardSkeleton rows={2} columns={2} variant="chart" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void revalidator.revalidate();
          }}
          title="Reîmprospătează datele de calitate"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Reîncarcă
        </Button>
        <DataFreshnessIndicator refreshedAt={quality.refreshedAt} label="Date calitate" />
      </div>

      {latestMilestoneEvent?.milestone ? (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-600/50 dark:bg-amber-900/20">
          <Trophy className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          <div>
            <div className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              Prag: {latestMilestoneEvent.milestone} Golden Records
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Atins la{' '}
              {latestMilestoneEvent.createdAt
                ? new Date(latestMilestoneEvent.createdAt).toLocaleDateString('ro-RO')
                : '—'}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div role="region" aria-label="Quality distribution">
          <QualityDistributionChart
            total={quality.total}
            distribution={{
              bronze: quality.bronze.count,
              silver: quality.silver.count,
              golden: quality.golden.count,
              review: quality.review.count,
            }}
            onSliceClick={(level) => {
              const params = new URLSearchParams(searchParams);
              params.set('level', level);
              setSearchParams(params, { replace: true });
            }}
          />
        </div>

        <QualityTrendChart data={quality.trend} {...(rangeLabel ? { rangeLabel } : {})} />
      </div>

      <div className="grid gap-3 md:grid-cols-5" aria-live="polite">
        <PromotionRateCard label="La silver (24h)" value={quality.promotions.toSilver24h} />
        <PromotionRateCard
          label="La golden (24h)"
          value={quality.promotions.toGolden24h}
          variant="success"
        />
        <PromotionRateCard label="La silver (7 zile)" value={quality.promotions.toSilver7d} />
        <PromotionRateCard
          label="La golden (7 zile)"
          value={quality.promotions.toGolden7d}
          variant="success"
        />
        <PromotionRateCard
          label="Necesita review"
          value={quality.needsReviewCount}
          variant="warning"
        />
      </div>

      <div className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 dark:bg-slate-900/80 dark:border-slate-700/60">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span>Sumar nivele de calitate</span>
          <InfoTooltip title="Sumar calitate">
            Sumarul arată numărul de produse și scorul mediu pentru fiecare nivel. De ce contează:
            identifici rapid distribuția calității în catalog. Exemplu: 200 Bronze cu scor 0.3
            indică produse care necesită enrichment. Sfat: țintește mutarea produselor din Bronze
            spre Silver prin enrichment.
          </InfoTooltip>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <div
            className="rounded-md border border-muted/20 p-3 dark:border-slate-700 dark:bg-slate-800/50"
            aria-label="Bronze quality summary"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400">Bronze</div>
            <div className="text-h5 text-slate-800 dark:text-slate-100">{quality.bronze.count}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Medie:{' '}
              {quality.bronze.avgQualityScore != null
                ? quality.bronze.avgQualityScore.toFixed(2)
                : 'N/A'}
            </div>
          </div>
          <div
            className="rounded-md border border-muted/20 p-3 dark:border-slate-700 dark:bg-slate-800/50"
            aria-label="Silver quality summary"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400">Silver</div>
            <div className="text-h5 text-slate-800 dark:text-slate-100">{quality.silver.count}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Medie:{' '}
              {quality.silver.avgQualityScore != null
                ? quality.silver.avgQualityScore.toFixed(2)
                : 'N/A'}
            </div>
          </div>
          <div
            className="rounded-md border border-muted/20 p-3 dark:border-slate-700 dark:bg-slate-800/50"
            aria-label="Golden quality summary"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400">Golden</div>
            <div className="text-h5 text-slate-800 dark:text-slate-100">{quality.golden.count}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Medie:{' '}
              {quality.golden.avgQualityScore != null
                ? quality.golden.avgQualityScore.toFixed(2)
                : 'N/A'}
            </div>
          </div>
          <div
            className="rounded-md border border-muted/20 p-3 dark:border-slate-700 dark:bg-slate-800/50"
            aria-label="Review quality summary"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400">Review necesar</div>
            <div className="text-h5 text-slate-800 dark:text-slate-100">{quality.review.count}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Medie:{' '}
              {quality.review.avgQualityScore != null
                ? quality.review.avgQualityScore.toFixed(2)
                : 'N/A'}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 dark:bg-slate-900/80 dark:border-slate-700/60">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span>Detaliere pe nivel de calitate</span>
              <InfoTooltip title="Detaliere calitate">
                Detaliererea arată produsele dintr-un anumit nivel de calitate. De ce contează: poți
                vedea exact care produse au nevoie de atenție. Exemplu: click pe Bronze pentru a
                vedea produsele cu date incomplete. Sfat: folosește linkul „Vezi toate produsele"
                pentru o listă completă filtrată.
              </InfoTooltip>
            </div>
            <div className="text-sm">
              {selectedLevel ? `Nivel: ${selectedLevel}` : 'Selecteaza un segment pentru detalii'}
            </div>
          </div>
          {selectedLevel ? (
            <div className="flex items-center gap-2">
              <Link
                className="text-xs text-primary"
                to={`/products?qualityLevel=${encodeURIComponent(selectedLevel)}`}
              >
                Vezi toate produsele
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  params.delete('level');
                  setSearchParams(params, { replace: true });
                }}
              >
                Curata
              </Button>
            </div>
          ) : null}
        </div>

        {selectedLevel ? (
          <div className="overflow-hidden rounded-md border border-muted/20 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Produs</th>
                  <th className="px-3 py-2 text-left font-medium">Vendor</th>
                  <th className="px-3 py-2 text-right font-medium">Scor calitate</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400"
                      colSpan={3}
                    >
                      Se încarcă produsele...
                    </td>
                  </tr>
                ) : products?.items.length ? (
                  products.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t border-muted/20 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                    >
                      <td className="px-3 py-2">
                        <Link className="text-primary" to={`/products/${item.id}`}>
                          {item.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{item.vendor ?? '-'}</td>
                      <td className="px-3 py-2 text-right">
                        {item.qualityScore != null ? item.qualityScore.toFixed(2) : '-'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400"
                      colSpan={3}
                    >
                      Nu există produse pentru nivelul selectat.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-muted">Fa click pe un segment pentru a vedea produsele.</div>
        )}
      </div>
    </div>
  );
}
