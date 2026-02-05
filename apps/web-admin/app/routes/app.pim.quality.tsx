import type { LoaderFunctionArgs } from 'react-router-dom';
import { Link, useLoaderData, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { Download } from 'lucide-react';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Button } from '../components/ui/button';
import { QualityDistributionChart } from '../components/domain/QualityDistributionChart';
import { QualityTrendChart } from '../components/domain/QualityTrendChart';
import { useApiClient, useApiRequest } from '../hooks/use-api';
import { apiLoader, createLoaderApiClient, type LoaderData } from '../utils/loaders';

interface QualityDistributionResponse {
  bronze: { count: number; percentage: number };
  silver: { count: number; percentage: number };
  golden: { count: number; percentage: number };
  review: { count: number; percentage: number };
  total: number;
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

export const loader = apiLoader(async (_args: LoaderFunctionArgs) => {
  const api = createLoaderApiClient();
  return {
    quality: await api.getApi<QualityDistributionResponse>('/pim/stats/quality-distribution'),
  };
});

type RouteLoaderData = LoaderData<typeof loader>;

export default function QualityProgressPage() {
  const { quality } = useLoaderData<RouteLoaderData>();
  const [searchParams, setSearchParams] = useSearchParams();
  const api = useApiClient();
  const {
    run,
    data: products,
    loading,
  } = useApiRequest((level: string) =>
    api.getApi<ProductsResponse>(
      `/products?qualityLevel=${encodeURIComponent(level)}&sortBy=updated_at&sortOrder=desc`
    )
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
          onSliceClick={(level) => {
            const params = new URLSearchParams(searchParams);
            params.set('level', level);
            setSearchParams(params, { replace: true });
          }}
        />

        <QualityTrendChart data={quality.trend} {...(rangeLabel ? { rangeLabel } : {})} />
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
