import { Activity, AlertTriangle, Cpu, Package, RefreshCw } from 'lucide-react';

import type { ComponentType } from 'react';
import type { LoaderFunctionArgs } from 'react-router-dom';
import { useLoaderData, useRevalidator } from 'react-router-dom';

import { PolarisCard } from '../../components/polaris/index.js';
import { Button } from '../components/ui/button';
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
}

export default function DashboardIndex() {
  const { summary } = useLoaderData<RouteLoaderData>();
  const revalidator = useRevalidator();
  const numberFormatter = new Intl.NumberFormat('ro-RO');
  const percentFormatter = new Intl.NumberFormat('ro-RO', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const kpis: Kpi[] = [
    {
      title: 'Produse Totale',
      value: numberFormatter.format(summary.totalProducts),
      subtext: 'Total produse în Shopify mirror',
      icon: Package,
    },
    {
      title: 'Procese Active',
      value: numberFormatter.format(summary.activeBulkRuns),
      subtext: 'Bulk runs în status pending/running',
      icon: Cpu,
    },
    {
      title: 'Rata Erori API',
      value: summary.apiErrorRate != null ? percentFormatter.format(summary.apiErrorRate) : 'N/A',
      subtext: 'Ultimele 24h',
      icon: AlertTriangle,
    },
    {
      title: 'API Latency p95',
      value: summary.apiLatencyP95Ms != null ? `${Math.round(summary.apiLatencyP95Ms)} ms` : 'N/A',
      subtext: 'Ultimele 24h',
      icon: Activity,
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-h1">Neanelu Monitor</h1>
          <p className="mt-1 text-body text-muted">Prezentare sistem si status de sanatate</p>
        </div>

        <Button variant="secondary" onClick={() => void revalidator.revalidate()}>
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="size-4" />
            Reincarca datele
          </span>
        </Button>
      </header>

      <SafeComponent>
        <SystemAlertsBanner />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;

            return (
              <PolarisCard key={kpi.title}>
                <div className="rounded-md border border-muted/20 bg-background p-4 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-caption text-muted">{kpi.title}</div>
                      <div className="mt-1 text-h3">{kpi.value}</div>
                    </div>
                    <Icon className="size-5 text-muted" />
                  </div>
                  <div className="mt-3 text-caption text-muted">{kpi.subtext}</div>
                </div>
              </PolarisCard>
            );
          })}
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ActivityTimeline />
          <QuickActionsPanel />
        </section>
      </SafeComponent>
    </div>
  );
}
