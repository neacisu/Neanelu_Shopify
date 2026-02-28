import { useEffect } from 'react';
import type { LoaderFunctionArgs } from 'react-router-dom';
import { useLoaderData, useNavigate, useRevalidator } from 'react-router-dom';
import { PackageSearch } from 'lucide-react';

import { useCountUp } from '../hooks/useCountUp';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { InfoTooltip } from '../components/ui/info-tooltip';
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

function PimCountUp({ value, format }: { value: number; format: (n: number) => string }) {
  return <>{useCountUp(value, { format })}</>;
}

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
  const activeSourcesCount = sources.sources.filter((s) => s.isActive).length;
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
        title="PIM nu are încă produse"
        description="Importă produse sau rulează o ingestie ca să poți începe enrichment și Golden Record."
        actionLabel="Importă produse"
        onAction={() => void navigate('/products/import')}
      />
    );
  }

  const [gridRef, gridVisible] = useScrollReveal<HTMLDivElement>({
    rootMargin: '0px 0px -40px 0px',
  });

  return (
    <div className="space-y-6" style={{ animation: 'fadeIn 0.5s ease-out both' }}>
      <div ref={gridRef} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div
          className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 dark:bg-slate-900/80 dark:border-slate-700/60 transition-shadow duration-200 hover:shadow-md"
          style={{
            animation: gridVisible ? 'fadeSlideUp 0.4s ease-out both' : 'none',
          }}
        >
          <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>Total produse</span>
            <InfoTooltip title="Total produse PIM">
              Total produse este suma tuturor produselor din catalogul PIM (Bronze + Silver + Golden
              + Review). De ce contează: reflectă dimensiunea catalogului tău. Exemplu: dacă vezi
              1200 produse, toate sunt gestionate în PIM. Sfat: crește numărul prin importuri
              regulate.
            </InfoTooltip>
          </div>
          <div className="text-h4 tabular-nums text-slate-800 dark:text-slate-100">
            <PimCountUp value={total} format={(n) => String(Math.round(n))} />
          </div>
          <Sparkline data={[quality.bronze.count, quality.silver.count, quality.golden.count]} />
        </div>
        <div
          className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 dark:bg-slate-900/80 dark:border-slate-700/60 transition-shadow duration-200 hover:shadow-md"
          style={{
            animation: gridVisible ? 'fadeSlideUp 0.4s ease-out 0.05s both' : 'none',
          }}
        >
          <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>Rata golden</span>
            <InfoTooltip title="Rata golden">
              Rata golden indică procentul produselor cu nivel Golden Record. De ce contează: Golden
              Record înseamnă date complete și validate din surse multiple. Exemplu: 45% golden =
              aproape jumătate din catalog are date de înaltă calitate. Sfat: crește rata prin
              enrichment regulat.
            </InfoTooltip>
          </div>
          <GaugeChart value={Math.round(goldenPct * 100)} max={100} ariaLabel="Rata golden" />
        </div>
        <div
          className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 dark:bg-slate-900/80 dark:border-slate-700/60 transition-shadow duration-200 hover:shadow-md"
          style={{
            animation: gridVisible ? 'fadeSlideUp 0.4s ease-out 0.1s both' : 'none',
          }}
        >
          <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>Scor calitate mediu</span>
            <InfoTooltip title="Scor calitate">
              Scorul mediu de calitate al datelor (0–1) pe tot catalogul. De ce contează: reflectă
              completitudinea și acuratețea datelor produs. Exemplu: un scor de 0.78 indică date
              bune, dar cu spațiu de îmbunătățire. Sfat: urmărește trendul săptămânal pentru a
              detecta regresii.
            </InfoTooltip>
          </div>
          <GaugeChart
            value={Number(avgQuality.toFixed(2))}
            max={1}
            ariaLabel="Scor mediu de calitate"
          />
        </div>
        <div
          className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 dark:bg-slate-900/80 dark:border-slate-700/60 transition-shadow duration-200 hover:shadow-md"
          style={{
            animation: gridVisible ? 'fadeSlideUp 0.4s ease-out 0.15s both' : 'none',
          }}
        >
          <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>Surse active</span>
            <InfoTooltip title="Surse active">
              Sursele active sunt canalele externe (eMAG, producători, etc.) care furnizează date.
              De ce contează: mai multe surse cresc calitatea și acuratețea datelor. Exemplu: 5
              surse active pot oferi specificații complementare. Sfat: verifică periodic sursele
              inactive în tabul Enrichment.
            </InfoTooltip>
          </div>
          <div className="text-h4 tabular-nums text-slate-800 dark:text-slate-100">
            <PimCountUp value={activeSourcesCount} format={(n) => String(Math.round(n))} />
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
        <div
          className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 dark:bg-slate-900/80 dark:border-slate-700/60"
          style={{ animation: 'fadeSlideUp 0.4s ease-out 0.2s both' }}
        >
          <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>Etape pipeline enrichment</span>
            <InfoTooltip title="Pipeline enrichment">
              Pipeline-ul de enrichment este secvența de etape pentru îmbogățirea datelor produs. De
              ce contează: arată câte produse sunt în fiecare etapă. Exemplu: dacă „scraper" are
              status Bottleneck, înseamnă că datele se acumulează acolo. Sfat: monitorizează etapele
              cu status Active sau Bottleneck.
            </InfoTooltip>
          </div>
          <EnrichmentPipelineViz stages={enrichment.pipelineStages} />
        </div>
        <div
          className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 dark:bg-slate-900/80 dark:border-slate-700/60"
          style={{ animation: 'fadeSlideUp 0.4s ease-out 0.25s both' }}
        >
          <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>Sănătate surse (top)</span>
            <InfoTooltip title="Sănătate surse">
              Sănătatea surselor arată rata de succes a fiecărei surse externe. De ce contează:
              sursele cu succes scăzut returnează date incomplete sau eronate. Exemplu: dacă eMAG
              are 60% succes, poate necesita investigare. Sfat: verifică sursele cu rată sub 70% în
              tabul Enrichment.
            </InfoTooltip>
          </div>
          <div className="space-y-2 text-sm text-slate-800 dark:text-slate-100">
            {sources.sources.slice(0, 3).map((source) => (
              <div
                key={`${source.sourceName}-${source.sourceType}`}
                className="flex justify-between gap-2"
              >
                <span>{source.sourceName}</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {source.successRate.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 dark:bg-slate-900/80 dark:border-slate-700/60"
        style={{ animation: 'fadeSlideUp 0.4s ease-out 0.3s both' }}
      >
        <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span>Status sincronizare canale</span>
          <InfoTooltip title="Sincronizare canale">
            Sincronizarea arată câte produse sunt actualizate pe fiecare canal (Shopify, eMAG). De
            ce contează: o rată scăzută poate duce la date diferite între canale. Exemplu: 95% sync
            pe Shopify = aproape toate produsele sunt la zi. Sfat: prioritizează sincronizarea
            pentru nivel Golden.
          </InfoTooltip>
        </div>
        <div className="overflow-auto rounded-md border dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2 text-left text-slate-800 dark:text-slate-100">
                  Nivel calitate
                </th>
                <th className="px-3 py-2 text-left text-slate-800 dark:text-slate-100">Canal</th>
                <th className="px-3 py-2 text-right text-slate-800 dark:text-slate-100">Produse</th>
                <th className="px-3 py-2 text-right text-slate-800 dark:text-slate-100">
                  Sincronizate
                </th>
                <th className="px-3 py-2 text-right text-slate-800 dark:text-slate-100">
                  Rata sync
                </th>
                <th className="px-3 py-2 text-right text-slate-800 dark:text-slate-100">
                  Scor mediu
                </th>
              </tr>
            </thead>
            <tbody>
              {syncStatus.syncStatus.map((item) => {
                const style = getSyncRateClasses(item.syncRate);
                return (
                  <tr
                    key={`${item.dataQualityLevel}-${item.channel}`}
                    className="border-t border-muted/20 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                  >
                    <td className="px-3 py-2">{item.dataQualityLevel}</td>
                    <td className="px-3 py-2">{item.channel}</td>
                    <td className="px-3 py-2 text-right">{item.productCount}</td>
                    <td className="px-3 py-2 text-right">{item.syncedCount}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2 w-full min-w-24 overflow-hidden rounded-full bg-muted/30 dark:bg-slate-700"
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
