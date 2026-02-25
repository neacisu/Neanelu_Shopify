import { Activity, AlertTriangle, Cpu, Package, RefreshCw } from 'lucide-react';

import type { ComponentType } from 'react';
import { useCallback, useState } from 'react';
import type { LoaderFunctionArgs } from 'react-router-dom';
import { useLoaderData, useRevalidator } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '../components/ui/button';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { SafeComponent } from '../components/errors/safe-component';
import { apiLoader, createLoaderApiClient, type LoaderData } from '../utils/loaders';
import { ActivityTimeline } from './dashboard/components/ActivityTimeline';
import { QuickActionsPanel } from './dashboard/components/QuickActionsPanel';
import { SystemAlertsBanner } from './dashboard/components/SystemAlertsBanner';

export const loader = apiLoader(async (_args: LoaderFunctionArgs) => {
  const api = createLoaderApiClient();
  return {
    summary: await api.getApi<DashboardSummaryResponse>('/dashboard/summary'),
  };
});

type RouteLoaderData = LoaderData<typeof loader>;

interface DashboardSummaryResponse {
  totalProducts: number;
  activeBulkRuns: number;
  apiErrorRate: number | null;
  apiLatencyP95Ms: number | null;
}

interface Kpi {
  title: string;
  value: string;
  subtext: string;
  icon: ComponentType<{ className?: string }>;
  tooltip: string;
}

export default function DashboardIndex() {
  const { summary } = useLoaderData<RouteLoaderData>();
  const revalidator = useRevalidator();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const numberFormatter = new Intl.NumberFormat('ro-RO');
  const percentFormatter = new Intl.NumberFormat('ro-RO', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const refreshAll = useCallback(() => {
    if (refreshing || revalidator.state === 'loading') return;
    setRefreshing(true);
    toast.message('Reincarc datele…');

    // Loader-backed summary
    void revalidator.revalidate();

    // React Query-backed panels
    void queryClient
      .refetchQueries({ queryKey: ['dashboard'], type: 'active' })
      .then(() => {
        toast.success('Date reincarcate');
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Reincarcarea a esuat');
      })
      .finally(() => {
        setRefreshing(false);
      });
  }, [queryClient, refreshing, revalidator]);

  const kpis: Kpi[] = [
    {
      title: 'Produse Totale',
      value: numberFormatter.format(summary.totalProducts),
      subtext: 'Total produse în Shopify mirror',
      icon: Package,
      tooltip:
        'Numărul total de produse din magazinul tău Shopify care sunt sincronizate în aplicație. Acest număr reflectă câte produse au fost importate și sunt gestionate de Neanelu. Pentru o sincronizare completă de produse din Shopify folosești pagina Ingestion din meniu.',
    },
    {
      title: 'Procese Active',
      value: numberFormatter.format(summary.activeBulkRuns),
      subtext: 'Bulk runs în status pending/running',
      icon: Cpu,
      tooltip:
        'Câte rulări de ingestie în masă (bulk) sunt în curs sau în așteptare: doar din tabelul de sincronizare completă a produselor din Shopify. Nu include cozile de webhooks, îmbogățiri AI sau alte job-uri. Dacă valoarea e 0, nu rulează nici o sincronizare bulk.',
    },
    {
      title: 'Rata Erori API',
      value: summary.apiErrorRate != null ? percentFormatter.format(summary.apiErrorRate) : 'N/A',
      subtext: 'Ultimele 24h',
      icon: AlertTriangle,
      tooltip:
        'Procentul de cereri API care au întâmpinat erori în ultimele 24 de ore. O valoare aproape de 0% înseamnă că sistemul funcționează stabil. Dacă rata crește peste 5%, ar putea indica probleme de conectivitate cu Shopify sau cu serviciile AI. „N/A" apare când nu au existat cereri în ultimele 24h.',
    },
    {
      title: 'API Latency p95',
      value: summary.apiLatencyP95Ms != null ? `${Math.round(summary.apiLatencyP95Ms)} ms` : 'N/A',
      subtext: 'Ultimele 24h',
      icon: Activity,
      tooltip:
        'Timpul de răspuns al sistemului, măsurat la percentila 95 — adică 95% din cereri au fost procesate mai rapid decât această valoare. Sub 500 ms este excelent, între 500-2000 ms este acceptabil, iar peste 2000 ms indică o posibilă încetinire. „N/A" apare când nu au existat cereri în ultimele 24h.',
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Neanelu Monitor</h1>
          <p className="mt-1 text-sm text-slate-500">Prezentare sistem și status de sănătate</p>
        </div>

        <div className="flex items-center gap-2">
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
            Reîmprospătează toate informațiile afișate pe dashboard: numărul de produse, procesele
            active, rata de erori, graficul de activitate și alertele de sistem. Este mai rapid
            decât un refresh complet al paginii — reîncarcă doar datele, nu întreaga interfață.
          </InfoTooltip>
        </div>
      </header>

      <SafeComponent>
        <SystemAlertsBanner />

        <section
          aria-labelledby="dashboard-kpis-heading"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <h2 id="dashboard-kpis-heading" className="sr-only">
            Indicatori cheie
          </h2>
          {kpis.map((kpi, index) => {
            const Icon = kpi.icon;

            return (
              <article
                key={kpi.title}
                className="group/kpi overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-[var(--shadow-sm)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-slate-300/80 hover:shadow-[var(--shadow-md)] focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:ring-offset-2"
                style={{
                  animation: `fadeSlideUp 0.4s ease-out both`,
                  animationDelay: `${index * 80}ms`,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                      {kpi.title}
                      <InfoTooltip title={kpi.title}>{kpi.tooltip}</InfoTooltip>
                    </div>
                    <p className="mt-1.5 text-xl font-bold tabular-nums text-slate-800 transition-colors duration-200 group-hover/kpi:text-blue-600">
                      {kpi.value}
                    </p>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-all duration-300 group-hover/kpi:bg-blue-50 group-hover/kpi:text-blue-600">
                    <Icon className="size-5" />
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">{kpi.subtext}</p>
              </article>
            );
          })}
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="animate-[fadeIn_0.5s_ease-out_both]" style={{ animationDelay: '350ms' }}>
            <ActivityTimeline />
          </div>
          <div
            className="animate-[fadeSlideUp_0.4s_ease-out_both]"
            style={{ animationDelay: '450ms' }}
          >
            <QuickActionsPanel />
          </div>
        </section>
      </SafeComponent>
    </div>
  );
}
