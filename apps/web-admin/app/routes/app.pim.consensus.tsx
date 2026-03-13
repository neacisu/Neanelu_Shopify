import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { Tabs } from '../components/ui/tabs';
import { ConsensusStatsCards } from '../components/domain/ConsensusStatsCards';
import { ConsensusProductsTable } from '../components/domain/ConsensusProductsTable';
import { ConsensusSourcesChart } from '../components/domain/ConsensusSourcesChart';
import { ConsensusDetailDrawer } from '../components/domain/ConsensusDetailDrawer';
import { DonutChart } from '../components/charts/DonutChart';
import { DashboardSkeleton } from '../components/patterns/DashboardSkeleton.js';
import { EmptyState } from '../components/patterns/empty-state.js';
import { ErrorState } from '../components/patterns/error-state.js';
import { LoadingState } from '../components/patterns/loading-state.js';
import { toast } from 'sonner';
import { useConsensusStats } from '../hooks/use-consensus-stats';
import { useConsensusProducts } from '../hooks/use-consensus-products';
import { useConsensusStream } from '../hooks/use-consensus-stream';
import { useApiClient } from '../hooks/use-api';
import type { ConsensusDetail, ConsensusProductItem } from '@app/types';

export default function PimConsensusPage() {
  const [tab, setTab] = useState<'all' | 'pending' | 'conflicts'>('all');
  const [selected, setSelected] = useState<ConsensusProductItem | null>(null);
  const [detail, setDetail] = useState<ConsensusDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
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
      { name: 'Conflicte', value: stats.productsWithConflicts },
      { name: 'Calculat', value: computed },
      { name: 'In asteptare', value: stats.pendingConsensus },
    ];
  }, [statsQuery.data]);

  useEffect(() => {
    void statsQuery.run();
  }, [statsQuery]);

  useEffect(() => {
    void productsQuery.run({ status: tab });
  }, [productsQuery, tab]);

  useEffect(() => {
    const id = setInterval(() => {
      void statsQuery.run();
      void productsQuery.run({ status: tab });
    }, 120_000);
    return () => clearInterval(id);
  }, [productsQuery, statsQuery, tab]);

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
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    void api
      .getApi<ConsensusDetail>(`/products/${selected.productId}/consensus/details`)
      .then((data) => setDetail(data))
      .catch((error) => {
        setDetail(null);
        toast.error(error instanceof Error ? error.message : 'Nu pot încărca detaliile consensus.');
      })
      .finally(() => setDetailLoading(false));
  }, [api, selected]);

  const handleSelect = (item: ConsensusProductItem) => {
    setSelected(item);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => void statsQuery.run()} size="sm">
          Reincarca
        </Button>
      </div>

      {statsQuery.loading && !statsQuery.data ? <DashboardSkeleton rows={1} columns={3} /> : null}
      {statsQuery.error && !statsQuery.data ? (
        <ErrorState
          message="Nu pot incarca statisticile consensus."
          onRetry={() => {
            void statsQuery.run();
          }}
        />
      ) : null}
      {statsQuery.data ? <ConsensusStatsCards stats={statsQuery.data} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ConsensusSourcesChart data={sourcesChartData} />
        <Card padding="md">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-primary">
            Evenimente consens în timp real
            <InfoTooltip title="Evenimente consens">
              Fluxul de evenimente în timp real arată acțiunile de consens pe măsură ce apar. De ce
              contează: poți urmări instant recalculări și rezolvări de conflicte. Exemplu: un
              eveniment „consensus.computed" confirmă actualizarea datelor. Sfat: verifică
              evenimentele după ce rulezi o recalculare.
            </InfoTooltip>
          </div>
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
            {stream.events.length === 0 ? (
              <EmptyState title="Nu există evenimente" description="Nu există evenimente încă." />
            ) : null}
          </div>
        </Card>
        <Card padding="md">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-primary">
            Distribuție conflicte
            <InfoTooltip title="Distribuție conflicte">
              Graficul arată proporția produselor cu conflicte, calcul finalizat și cele în
              așteptare. De ce contează: un procent mare de conflicte indică surse cu date
              inconsistente. Exemplu: 30% conflicte = o treime din produse au valori contradictorii.
              Sfat: rezolvă conflictele din tabul „Conflicte".
            </InfoTooltip>
          </div>
          <DonutChart data={conflictDistribution} height={220} showLegend />
        </Card>
      </div>

      <div className="space-y-4">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as typeof tab)}
          items={[
            { value: 'all', label: 'Toate produsele' },
            { value: 'pending', label: 'In asteptare' },
            { value: 'conflicts', label: 'Conflicte' },
          ]}
        />
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {productsQuery.loading
            ? 'Se încarcă...'
            : `${products.length} produse cu date de consens`}
        </p>
        {productsQuery.loading && !productsQuery.data ? (
          <LoadingState label="Se incarca lista de produse…" />
        ) : null}
        {productsQuery.error ? (
          <ErrorState
            message="Nu pot incarca lista de produse consensus."
            onRetry={() => {
              void productsQuery.run({ status: tab });
            }}
          />
        ) : null}
        {tab === 'all' ? (
          products.length === 0 && !productsQuery.loading ? (
            <EmptyState
              title="Nu există produse"
              description="Nu există produse cu date de consens disponibile."
            />
          ) : (
            <div
              className={
                productsQuery.loading && productsQuery.data
                  ? 'pointer-events-none opacity-60'
                  : undefined
              }
            >
              <ConsensusProductsTable items={products} onSelect={handleSelect} />
            </div>
          )
        ) : null}
        {tab === 'pending'
          ? (() => {
              const filtered = products.filter((item) => item.consensusStatus === 'pending');
              return filtered.length === 0 && !productsQuery.loading ? (
                <EmptyState
                  title="Nu există produse în așteptare"
                  description="Toate produsele au fost procesate."
                />
              ) : (
                <ConsensusProductsTable items={filtered} onSelect={handleSelect} />
              );
            })()
          : null}
        {tab === 'conflicts'
          ? (() => {
              const filtered = products.filter((item) => item.consensusStatus === 'conflicts');
              return filtered.length === 0 && !productsQuery.loading ? (
                <EmptyState
                  title="Nu există conflicte"
                  description="Nu există produse cu conflicte de consens."
                />
              ) : (
                <ConsensusProductsTable items={filtered} onSelect={handleSelect} />
              );
            })()
          : null}
      </div>

      {selected && detailLoading && !detail ? (
        <LoadingState label="Se incarca detaliile pentru produsul selectat…" />
      ) : null}
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
