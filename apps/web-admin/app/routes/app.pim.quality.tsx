import type { LoaderFunctionArgs } from 'react-router-dom';
import { Link, useLoaderData, useRevalidator, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { RefreshCw, Trophy } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '../components/ui/button';
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
    ? `${new Date(quality.trendRange.from).toLocaleDateString()} → ${new Date(
        quality.trendRange.to
      ).toLocaleDateString()}`
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
        toast.success(`Product promoted to ${newLevel}!`, {
          duration: 5000,
          icon: newLevel === 'golden' ? '🏆' : '⬆️',
        });
      }
      if (eventType === 'quality_demoted') {
        toast.warning(`Product demoted to ${newLevel}`, { duration: 5000 });
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
        toast.success(`Milestone reached: ${milestoneLabel} Golden Records!`, {
          description: 'Your data quality program is progressing!',
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
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <DataFreshnessIndicator refreshedAt={quality.refreshedAt} label="Quality data" />
      </div>

      {latestMilestoneEvent?.milestone ? (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <Trophy className="h-6 w-6 text-amber-600" />
          <div>
            <div className="text-sm font-semibold text-amber-700">
              Milestone: {latestMilestoneEvent.milestone} Golden Records
            </div>
            <div className="text-xs text-muted">
              Achieved on{' '}
              {latestMilestoneEvent.createdAt
                ? new Date(latestMilestoneEvent.createdAt).toLocaleDateString()
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
        <PromotionRateCard label="To Silver (24h)" value={quality.promotions.toSilver24h} />
        <PromotionRateCard
          label="To Golden (24h)"
          value={quality.promotions.toGolden24h}
          variant="success"
        />
        <PromotionRateCard label="To Silver (7d)" value={quality.promotions.toSilver7d} />
        <PromotionRateCard
          label="To Golden (7d)"
          value={quality.promotions.toGolden7d}
          variant="success"
        />
        <PromotionRateCard
          label="Needs Review"
          value={quality.needsReviewCount}
          variant="warning"
        />
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="mb-2 text-xs text-muted">Quality levels summary</div>
        <div className="grid gap-4 md:grid-cols-4">
          <div
            className="rounded-md border border-muted/20 p-3"
            aria-label="Bronze quality summary"
          >
            <div className="text-xs text-muted">Bronze</div>
            <div className="text-h5">{quality.bronze.count}</div>
            <div className="text-xs text-muted">
              Avg:{' '}
              {quality.bronze.avgQualityScore != null
                ? quality.bronze.avgQualityScore.toFixed(2)
                : 'N/A'}
            </div>
          </div>
          <div
            className="rounded-md border border-muted/20 p-3"
            aria-label="Silver quality summary"
          >
            <div className="text-xs text-muted">Silver</div>
            <div className="text-h5">{quality.silver.count}</div>
            <div className="text-xs text-muted">
              Avg:{' '}
              {quality.silver.avgQualityScore != null
                ? quality.silver.avgQualityScore.toFixed(2)
                : 'N/A'}
            </div>
          </div>
          <div
            className="rounded-md border border-muted/20 p-3"
            aria-label="Golden quality summary"
          >
            <div className="text-xs text-muted">Golden</div>
            <div className="text-h5">{quality.golden.count}</div>
            <div className="text-xs text-muted">
              Avg:{' '}
              {quality.golden.avgQualityScore != null
                ? quality.golden.avgQualityScore.toFixed(2)
                : 'N/A'}
            </div>
          </div>
          <div
            className="rounded-md border border-muted/20 p-3"
            aria-label="Review quality summary"
          >
            <div className="text-xs text-muted">Review needed</div>
            <div className="text-h5">{quality.review.count}</div>
            <div className="text-xs text-muted">
              Avg:{' '}
              {quality.review.avgQualityScore != null
                ? quality.review.avgQualityScore.toFixed(2)
                : 'N/A'}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-muted">Quality level drill-down</div>
            <div className="text-sm">
              {selectedLevel ? `Level: ${selectedLevel}` : 'Selectează un segment pentru detalii'}
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
                Clear
              </Button>
            </div>
          ) : null}
        </div>

        {selectedLevel ? (
          <div className="overflow-hidden rounded-md border border-muted/20">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-left font-medium">Vendor</th>
                  <th className="px-3 py-2 text-right font-medium">Quality score</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-3 py-3 text-sm text-muted" colSpan={3}>
                      Se încarcă produsele...
                    </td>
                  </tr>
                ) : products?.items.length ? (
                  products.items.map((item) => (
                    <tr key={item.id} className="border-t border-muted/20">
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
                    <td className="px-3 py-3 text-sm text-muted" colSpan={3}>
                      Nu există produse pentru nivelul selectat.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-muted">Fă click pe un segment pentru a vedea produsele.</div>
        )}
      </div>
    </div>
  );
}
