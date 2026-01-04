import { Activity, AlertTriangle, Cpu, Package, RefreshCw } from 'lucide-react';

import type { ComponentType } from 'react';
import { useLoaderData, useRevalidator } from 'react-router-dom';

import { PolarisButton, PolarisCard } from '../../components/polaris/index.js';
import { SafeComponent } from '../components/errors/safe-component';
import { ErrorState, LoadingState } from '../components/patterns';
import { createApiClient } from '../lib/api-client';

interface HealthReadyResponse {
  status: 'ready' | 'not_ready' | (string & {});
  checks?: Record<string, 'ok' | 'fail' | (string & {})>;
}

export async function loader() {
  const api = createApiClient();

  return {
    health: await api.getJson<HealthReadyResponse>('/health/ready'),
  };
}

interface Kpi {
  title: string;
  value: string;
  subtext: string;
  icon: ComponentType<{ className?: string }>;
}

const kpis: Kpi[] = [
  {
    title: 'Produse Totale',
    value: '1,024,500',
    subtext: '+150 azi',
    icon: Package,
  },
  {
    title: 'Cozi Active',
    value: '45 Jobs',
    subtext: 'Processing speed: 12/s',
    icon: Cpu,
  },
  {
    title: 'System Health',
    value: 'Operational',
    subtext: 'Redis Latency: 4ms',
    icon: Activity,
  },
  {
    title: 'Rata Erori',
    value: '0.02%',
    subtext: 'Target < 0.1%',
    icon: AlertTriangle,
  },
];

export default function DashboardIndex() {
  const { health } = useLoaderData<{ health: HealthReadyResponse }>();
  const revalidator = useRevalidator();
  const isRefreshing = revalidator.state === 'loading';

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-h1">Neanelu Monitor</h1>
          <p className="mt-1 text-body text-muted">System Overview & Health Status</p>
        </div>

        <PolarisButton onClick={() => void revalidator.revalidate()}>
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="size-4" />
            Refresh Data
          </span>
        </PolarisButton>
      </header>

      <SafeComponent>
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {kpis
            .filter((kpi) => kpi.title !== 'System Health')
            .map((kpi) => {
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

          <PolarisCard>
            <div className="rounded-md border border-muted/20 bg-background p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-caption text-muted">System Health</div>
                  <div className="mt-2">
                    {isRefreshing ? (
                      <LoadingState label="Checking health..." />
                    ) : (
                      (() => {
                        const isReady = health.status === 'ready';
                        const checks = health.checks ?? {};
                        const failedChecks = Object.entries(checks)
                          .filter(([, v]) => v !== 'ok')
                          .map(([k]) => k);

                        return (
                          <div>
                            <div className="text-h3">{isReady ? 'Operational' : 'Degraded'}</div>
                            <div className="mt-2 text-caption text-muted">
                              {failedChecks.length
                                ? `Issues: ${failedChecks.join(', ')}`
                                : 'All checks passing'}
                            </div>
                          </div>
                        );
                      })()
                    )}

                    {!isRefreshing && health.status !== 'ready' ? (
                      <ErrorState
                        message="Health check reported degraded status."
                        onRetry={() => void revalidator.revalidate()}
                      />
                    ) : null}
                  </div>
                </div>
                <Activity className="size-5 text-muted" />
              </div>
            </div>
          </PolarisCard>
        </section>
      </SafeComponent>
    </div>
  );
}
