import { Activity, AlertTriangle, Cpu, Package, RefreshCw } from 'lucide-react';

import type { ComponentType } from 'react';
import { useCallback, useState } from 'react';
import type { LoaderFunctionArgs } from 'react-router-dom';
import { useLoaderData, useRevalidator } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { PolarisCard } from '../../components/polaris/index.js';
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
          <h1 className="text-h1">Neanelu Monitor</h1>
          <p className="mt-1 text-body text-muted">Prezentare sistem si status de sanatate</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={refreshing || revalidator.state === 'loading'}
            onClick={refreshAll}
            className="transition-all duration-300 ease-out hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm"
          >
            <span className="inline-flex items-center gap-2">
              <RefreshCw
                className={`size-4 transition-transform duration-500 ${
                  refreshing || revalidator.state === 'loading' ? 'animate-spin' : ''
                }`}
              />
              {refreshing || revalidator.state === 'loading' ? 'Se reincarca…' : 'Reincarca datele'}
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

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi, index) => {
            const Icon = kpi.icon;

            return (
              <PolarisCard key={kpi.title}>
                <div
                  className="group/kpi rounded-md border border-muted/20 bg-background p-4 shadow-sm
                             transition-all duration-300 ease-out
                             hover:shadow-md hover:-translate-y-1 hover:border-primary/30
                             animate-[fadeSlideUp_0.4s_ease-out_both]"
                  style={{ animationDelay: `${index * 80}ms` }}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1 text-caption text-muted">
                        {kpi.title}
                        <InfoTooltip title={kpi.title}>{kpi.tooltip}</InfoTooltip>
                      </div>
                      <div className="mt-1 text-h3 transition-colors duration-200 group-hover/kpi:text-primary">
                        {kpi.value}
                      </div>
                    </div>
                    <Icon className="size-5 text-muted transition-all duration-300 group-hover/kpi:text-primary group-hover/kpi:scale-110" />
                  </div>
                  <div className="mt-3 text-caption text-muted">{kpi.subtext}</div>
                </div>
              </PolarisCard>
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
