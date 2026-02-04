import type { LoaderFunctionArgs } from 'react-router-dom';
import { useLoaderData } from 'react-router-dom';
import { DollarSign, TrendingDown, TrendingUp } from 'lucide-react';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Button } from '../components/ui/button';
import { BudgetAlertsPanel } from '../components/domain/BudgetAlertsPanel';
import { CostBreakdownChart } from '../components/domain/CostBreakdownChart';
import { ProviderComparisonTable } from '../components/domain/ProviderComparisonTable';
import { apiLoader, createLoaderApiClient, type LoaderData } from '../utils/loaders';

interface CostTrackingResponse {
  today: { serper: number; xai: number; total: number };
  thisWeek: { serper: number; xai: number; total: number };
  thisMonth: { serper: number; xai: number; total: number };
  budget: {
    daily: number;
    used: number;
    percentage: number;
    status: 'ok' | 'warning' | 'critical';
  };
  costPerGolden: { current: number; target: number; trend: number };
  breakdown: { date: string; search: number; audit: number; extraction: number }[];
}

export const loader = apiLoader(async (_args: LoaderFunctionArgs) => {
  const api = createLoaderApiClient();
  return {
    costs: await api.getApi<CostTrackingResponse>('/pim/stats/cost-tracking'),
  };
});

type RouteLoaderData = LoaderData<typeof loader>;

export default function CostTrackingPage() {
  const { costs } = useLoaderData<RouteLoaderData>();
  const trendValue = costs.costPerGolden.trend;
  const trendDirection = trendValue >= 0 ? 'up' : 'down';
  const trendLabel = `${Math.abs(trendValue).toFixed(1)}%`;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/' },
          { label: 'PIM', href: '/pim/costs' },
          { label: 'Cost Tracking' },
        ]}
      />

      <PageHeader
        title="API Cost Management"
        description="Monitorizează costurile Serper/xAI și bugetele zilnice."
        actions={
          <Button variant="secondary" size="sm">
            <DollarSign className="mr-2 h-4 w-4" />
            Budget settings
          </Button>
        }
      />

      <BudgetAlertsPanel budget={costs.budget} />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <CostBreakdownChart data={costs.breakdown} />

        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="mb-2 text-xs text-muted">Cost per Golden Record</div>
          <div className="text-h3">{costs.costPerGolden.current.toFixed(2)}</div>
          <div className="text-xs text-muted">Target: {costs.costPerGolden.target.toFixed(2)}</div>
          <div
            className={`mt-2 inline-flex items-center gap-1 text-xs ${
              trendDirection === 'up' ? 'text-emerald-500' : 'text-red-500'
            }`}
          >
            {trendDirection === 'up' ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {trendLabel} vs periodă anterioară
          </div>
        </div>
      </div>

      <ProviderComparisonTable
        today={costs.today}
        thisWeek={costs.thisWeek}
        thisMonth={costs.thisMonth}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Today</div>
          <div className="text-h5">{costs.today.total.toFixed(2)}</div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">This week</div>
          <div className="text-h5">{costs.thisWeek.total.toFixed(2)}</div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">This month</div>
          <div className="text-h5">{costs.thisMonth.total.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}
