import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Button } from '../components/ui/button';
import { Tabs } from '../components/ui/tabs';
import { ConsensusStatsCards } from '../components/domain/ConsensusStatsCards';
import { ConsensusProductsTable } from '../components/domain/ConsensusProductsTable';
import { ConsensusSourcesChart } from '../components/domain/ConsensusSourcesChart';
import { ConsensusDetailDrawer } from '../components/domain/ConsensusDetailDrawer';
import { DonutChart } from '../components/charts/DonutChart';
import { toast } from 'sonner';
import { useConsensusStats } from '../hooks/use-consensus-stats';
import { useConsensusProducts } from '../hooks/use-consensus-products';
import { useConsensusStream } from '../hooks/use-consensus-stream';
import { useApiClient } from '../hooks/use-api';
import type { ConsensusDetail, ConsensusProductItem } from '../types/consensus';

export default function PimConsensusPage() {
  const [tab, setTab] = useState<'all' | 'pending' | 'conflicts'>('all');
  const [selected, setSelected] = useState<ConsensusProductItem | null>(null);
  const [detail, setDetail] = useState<ConsensusDetail | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const statsQuery = useConsensusStats();
  const productsQuery = useConsensusProducts();
  const stream = useConsensusStream();
  const api = useApiClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const products = productsQuery.data?.items ?? [];
  const sourcesChartData = useMemo(() => {
    if (!detail) return [];
    return detail.sources.map((source) => ({
      source: source.sourceName,
      trustScore: source.trustScore,
    }));
  }, [detail]);

  const conflictDistribution = useMemo(() => {
    const stats = statsQuery.data;
    if (!stats) return [];
    const computed = Math.max(stats.productsWithConsensus - stats.productsWithConflicts, 0);
    return [
      { name: 'Conflicts', value: stats.productsWithConflicts },
      { name: 'Computed', value: computed },
      { name: 'Pending', value: stats.pendingConsensus },
    ];
  }, [statsQuery.data]);

  useEffect(() => {
    void statsQuery.run();
  }, [statsQuery]);

  useEffect(() => {
    void productsQuery.run({ status: tab });
  }, [productsQuery, tab]);

  useEffect(() => {
    const productId = searchParams.get('productId');
    if (!productId || products.length === 0) return;
    const found = products.find((item) => item.productId === productId);
    if (found) {
      setSelected(found);
    }
  }, [products, searchParams]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    void api
      .getApi<ConsensusDetail>(`/products/${selected.productId}/consensus/details`)
      .then((data) => setDetail(data))
      .catch((error) => {
        setDetail(null);
        toast.error(error instanceof Error ? error.message : 'Nu pot încărca detaliile consensus.');
      });
  }, [api, selected]);

  const handleSelect = (item: ConsensusProductItem) => {
    setSelected(item);
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/app' },
          { label: 'PIM', href: '/app/pim' },
          { label: 'Consensus', href: '/app/pim/consensus' },
        ]}
      />
      <PageHeader
        title="Consensus Engine"
        description="Consensus status, conflicts and provenance across sources."
        actions={
          <Button onClick={() => void statsQuery.run()} size="sm">
            Refresh
          </Button>
        }
      />

      {statsQuery.data ? <ConsensusStatsCards stats={statsQuery.data} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ConsensusSourcesChart data={sourcesChartData} />
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="mb-2 text-xs text-muted">Real-time consensus events</div>
          <div className="max-h-64 space-y-2 overflow-y-auto text-xs text-muted">
            {stream.events.slice(0, 10).map((event, idx) => (
              <div key={`${event.type}-${idx}`} className="flex flex-col gap-1">
                <span className="font-medium text-foreground">{event.type}</span>
                {event.payload ? (
                  <span className="text-[11px] text-muted">
                    {JSON.stringify(event.payload).slice(0, 120)}
                  </span>
                ) : null}
              </div>
            ))}
            {stream.events.length === 0 ? <div>No events yet.</div> : null}
          </div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="mb-2 text-xs text-muted">Conflict distribution</div>
          <DonutChart data={conflictDistribution} height={220} showLegend />
        </div>
      </div>

      <div className="space-y-4">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as typeof tab)}
          items={[
            { value: 'all', label: 'All products' },
            { value: 'pending', label: 'Pending' },
            { value: 'conflicts', label: 'Conflicts' },
          ]}
        />
        {tab === 'all' ? <ConsensusProductsTable items={products} onSelect={handleSelect} /> : null}
        {tab === 'pending' ? (
          <ConsensusProductsTable
            items={products.filter((item) => item.consensusStatus === 'pending')}
            onSelect={handleSelect}
          />
        ) : null}
        {tab === 'conflicts' ? (
          <ConsensusProductsTable
            items={products.filter((item) => item.consensusStatus === 'conflicts')}
            onSelect={handleSelect}
          />
        ) : null}
      </div>

      {selected && detail ? (
        <ConsensusDetailDrawer
          isOpen={Boolean(selected)}
          onClose={() => setSelected(null)}
          onRecompute={() =>
            (() => {
              setRecomputing(true);
              void api
                .postApi(`/products/${selected.productId}/consensus`, {})
                .then(() => {
                  void statsQuery.run();
                  void productsQuery.run({ status: tab });
                  return api.getApi<ConsensusDetail>(
                    `/products/${selected.productId}/consensus/details`
                  );
                })
                .then((data) => setDetail(data))
                .catch((error) => {
                  toast.error(
                    error instanceof Error ? error.message : 'Recompute eșuat pentru consensus.'
                  );
                })
                .finally(() => setRecomputing(false));
            })()
          }
          isRecomputing={recomputing}
          onExport={() => {
            void api
              .getJson<unknown>(`/products/${selected.productId}/consensus/export`)
              .then((payload) => {
                const blob = new Blob([JSON.stringify(payload, null, 2)], {
                  type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `consensus-${selected.productId}.json`;
                link.click();
                URL.revokeObjectURL(url);
              });
          }}
          onViewProduct={() => void navigate(`/products/${selected.productId}`)}
          onResolveConflict={(attributeName: string, value: unknown) => {
            void api
              .postApi(`/products/${selected.productId}/conflicts/${attributeName}/resolve`, {
                value,
              })
              .then(() =>
                api.getApi<ConsensusDetail>(`/products/${selected.productId}/consensus/details`)
              )
              .then((data) => setDetail(data))
              .catch(() => undefined);
          }}
          title={selected.title}
          status={selected.consensusStatus}
          qualityScore={selected.qualityScore}
          conflictsCount={selected.conflictsCount}
          breakdown={detail.qualityBreakdown}
          sources={detail.sources}
          results={detail.results}
          conflicts={detail.conflicts.map((conflict) => ({
            attributeName: conflict.attributeName,
            reason: conflict.reason,
            values: Array.from(conflict.values),
          }))}
          provenance={detail.provenance}
          votesByAttribute={detail.votesByAttribute}
        />
      ) : null}
    </div>
  );
}
