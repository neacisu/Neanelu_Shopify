import { useEffect } from 'react';
import type { LoaderFunctionArgs } from 'react-router-dom';
import { useLoaderData, useNavigate, useRevalidator } from 'react-router-dom';
import { PackageSearch } from 'lucide-react';

import { GaugeChart } from '../components/charts/GaugeChart';
import { Sparkline } from '../components/charts/Sparkline';
import { QualityDistributionChart } from '../components/domain/QualityDistributionChart';
import { EnrichmentPipelineViz } from '../components/domain/EnrichmentPipelineViz';
import { DataFreshnessIndicator } from '../components/domain/DataFreshnessIndicator';
import { PromotionRateCard } from '../components/domain/PromotionRateCard';
import { DashboardSkeleton } from '../components/patterns/DashboardSkeleton';
import { EmptyState } from '../components/patterns/empty-state';
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
  lastUpdate: string | null;
  refreshedAt: string | null;
}

interface EnrichmentProgressResponse {
  pipelineStages: {
    id: string;
    name: string;
    count: number;
    status: 'idle' | 'active' | 'bottleneck';
    avgDuration: number | null;
  }[];
}

interface SourcePerformanceResponse {
  sources: {
    sourceName: string;
    sourceType: string;
    successRate: number;
    trustScore: number;
    isActive: boolean;
  }[];
  refreshedAt: string | null;
}

interface EnrichmentSyncResponse {
  syncStatus: {
    dataQualityLevel: string;
    channel: string;
    productCount: number;
    syncedCount: number;
    syncRate: number;
    avgQualityScore: number;
  }[];
  refreshedAt: string | null;
}

export const loader = apiLoader(async (_args: LoaderFunctionArgs) => {
  const api = createLoaderApiClient();
  const [quality, enrichment, sources, syncStatus] = await Promise.all([
    api.getApi<QualityDistributionResponse>('/pim/stats/quality-distribution'),
    api.getApi<EnrichmentProgressResponse>('/pim/stats/enrichment-progress'),
    api.getApi<SourcePerformanceResponse>('/pim/stats/source-performance'),
    api.getApi<EnrichmentSyncResponse>('/pim/stats/enrichment-sync'),
  ]);
  return { quality, enrichment, sources, syncStatus };
});

type RouteLoaderData = LoaderData<typeof loader>;

function getSyncRateClasses(syncRate: number): { text: string; bar: string } {
  if (syncRate >= 90) {
    return { text: 'text-success', bar: 'bg-success' };
  }
  if (syncRate >= 70) {
    return { text: 'text-warning', bar: 'bg-warning' };
  }
  return { text: 'text-danger', bar: 'bg-danger' };
}

export default function PimOverviewPage() {
  const { quality, enrichment, sources, syncStatus } = useLoaderData<RouteLoaderData>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  useEffect(() => {
    const id = setInterval(() => {
      void revalidator.revalidate();
    }, 120_000);
    return () => clearInterval(id);
  }, [revalidator]);

  const total = quality.total;
  const goldenPct = total > 0 ? quality.golden.count / total : 0;
  const avgQuality =
    total > 0
      ? ((quality.bronze.avgQualityScore ?? 0) * quality.bronze.count +
          (quality.silver.avgQualityScore ?? 0) * quality.silver.count +
          (quality.golden.avgQualityScore ?? 0) * quality.golden.count +
          (quality.review.avgQualityScore ?? 0) * quality.review.count) /
        Math.max(total, 1)
      : 0;

  if (revalidator.state === 'loading') {
    return <DashboardSkeleton rows={2} columns={3} variant="kpi" />;
  }

  if (total === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="PIM nu are inca produse"
        description="Importa produse sau ruleaza o ingestie ca sa poti incepe enrichment si Golden Record."
        actionLabel="Importa produse"
        onAction={() => void navigate('/products/import')}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="mb-2 text-xs text-muted">Total produse</div>
          <div className="text-h4">{total}</div>
          <Sparkline data={[quality.bronze.count, quality.silver.count, quality.golden.count]} />
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="mb-2 text-xs text-muted">Rata golden</div>
          <GaugeChart value={Math.round(goldenPct * 100)} max={100} ariaLabel="Rata golden" />
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="mb-2 text-xs text-muted">Scor calitate mediu</div>
          <GaugeChart
            value={Number(avgQuality.toFixed(2))}
            max={1}
            ariaLabel="Scor mediu de calitate"
          />
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="mb-2 text-xs text-muted">Surse active</div>
          <div className="text-h4">
            {sources.sources.filter((source) => source.isActive).length}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div role="region" aria-label="Quality distribution">
          <QualityDistributionChart
            total={quality.total}
            distribution={{
              bronze: quality.bronze.count,
              silver: quality.silver.count,
              golden: quality.golden.count,
              review: quality.review.count,
            }}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1" aria-live="polite">
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
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="mb-2 text-xs text-muted">Etape pipeline enrichment</div>
          <EnrichmentPipelineViz stages={enrichment.pipelineStages} />
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="mb-2 text-xs text-muted">Sanatate surse (top)</div>
          <div className="space-y-2 text-sm">
            {sources.sources.slice(0, 3).map((source) => (
              <div
                key={`${source.sourceName}-${source.sourceType}`}
                className="flex justify-between gap-2"
              >
                <span>{source.sourceName}</span>
                <span className="text-muted">{source.successRate.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="mb-2 text-xs text-muted">Status sincronizare canale</div>
        <div className="overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/20">
              <tr>
                <th className="px-3 py-2 text-left">Nivel calitate</th>
                <th className="px-3 py-2 text-left">Canal</th>
                <th className="px-3 py-2 text-right">Produse</th>
                <th className="px-3 py-2 text-right">Sincronizate</th>
                <th className="px-3 py-2 text-right">Rata sync</th>
                <th className="px-3 py-2 text-right">Scor mediu</th>
              </tr>
            </thead>
            <tbody>
              {syncStatus.syncStatus.map((item) => {
                const style = getSyncRateClasses(item.syncRate);
                return (
                  <tr
                    key={`${item.dataQualityLevel}-${item.channel}`}
                    className="border-t border-muted/20"
                  >
                    <td className="px-3 py-2">{item.dataQualityLevel}</td>
                    <td className="px-3 py-2">{item.channel}</td>
                    <td className="px-3 py-2 text-right">{item.productCount}</td>
                    <td className="px-3 py-2 text-right">{item.syncedCount}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2 w-full min-w-24 overflow-hidden rounded-full bg-muted/30"
                          role="presentation"
                          aria-hidden="true"
                        >
                          <div
                            className={`h-full transition-all ${style.bar}`}
                            style={{ width: `${Math.max(0, Math.min(100, item.syncRate))}%` }}
                          />
                        </div>
                        <span className={`w-14 text-right tabular-nums ${style.text}`}>
                          {item.syncRate.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{item.avgQualityScore.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <DataFreshnessIndicator refreshedAt={quality.refreshedAt} label="Date calitate" />
        <DataFreshnessIndicator refreshedAt={syncStatus.refreshedAt} label="Date sincronizare" />
        <DataFreshnessIndicator refreshedAt={sources.refreshedAt} label="Date surse" />
      </div>
    </div>
  );
}
