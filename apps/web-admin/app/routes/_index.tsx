import { Activity, AlertTriangle, Cpu, Package, RefreshCw } from 'lucide-react';

import type { ComponentType } from 'react';

import { PolarisButton, PolarisCard } from '../../components/polaris/index.js';

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
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-h1">Neanelu Monitor</h1>
          <p className="mt-1 text-body text-muted">System Overview & Health Status</p>
        </div>

        <PolarisButton>
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="size-4" />
            Refresh Data
          </span>
        </PolarisButton>
      </header>

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
    </div>
  );
}
