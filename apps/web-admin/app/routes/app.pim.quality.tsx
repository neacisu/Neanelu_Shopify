import type { LoaderFunctionArgs } from 'react-router-dom';
import { useLoaderData } from 'react-router-dom';
import { Download } from 'lucide-react';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Button } from '../components/ui/button';
import { QualityDistributionChart } from '../components/domain/QualityDistributionChart';
import { QualityTrendChart } from '../components/domain/QualityTrendChart';
import { apiLoader, createLoaderApiClient, type LoaderData } from '../utils/loaders';

interface QualityDistributionResponse {
  bronze: { count: number; percentage: number };
  silver: { count: number; percentage: number };
  golden: { count: number; percentage: number };
  review: { count: number; percentage: number };
  total: number;
  trend: { date: string; bronze: number; silver: number; golden: number }[];
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

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/' },
          { label: 'PIM', href: '/pim/quality' },
          { label: 'Quality Progress' },
        ]}
      />

      <PageHeader
        title="Quality Progress"
        description="Distribuția și evoluția nivelurilor bronze/silver/golden."
        actions={
          <Button variant="secondary" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <QualityDistributionChart
          total={quality.total}
          distribution={{
            bronze: quality.bronze.count,
            silver: quality.silver.count,
            golden: quality.golden.count,
            review: quality.review.count,
          }}
        />

        <QualityTrendChart data={quality.trend} />
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="mb-2 text-xs text-muted">Quality levels summary</div>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-md border border-muted/20 p-3">
            <div className="text-xs text-muted">Bronze</div>
            <div className="text-h5">{quality.bronze.count}</div>
          </div>
          <div className="rounded-md border border-muted/20 p-3">
            <div className="text-xs text-muted">Silver</div>
            <div className="text-h5">{quality.silver.count}</div>
          </div>
          <div className="rounded-md border border-muted/20 p-3">
            <div className="text-xs text-muted">Golden</div>
            <div className="text-h5">{quality.golden.count}</div>
          </div>
          <div className="rounded-md border border-muted/20 p-3">
            <div className="text-xs text-muted">Review needed</div>
            <div className="text-h5">{quality.review.count}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
