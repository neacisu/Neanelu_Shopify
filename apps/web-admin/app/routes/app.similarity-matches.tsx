import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Tabs } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { SimilarityMatchCard } from '../components/domain/SimilarityMatchCard';
import { SimilarityMatchDetailDrawer } from '../components/domain/SimilarityMatchDetailDrawer';
import {
  SimilarityMatchesFilters,
  type SimilarityMatchesFilterState,
} from '../components/domain/SimilarityMatchesFilters';
import { SimilarityMatchesStats } from '../components/domain/SimilarityMatchesStats';
import { SimilarityMatchesTable } from '../components/domain/SimilarityMatchesTable';
import {
  useSimilarityMatches,
  useSimilarityMatchesStats,
  useSimilarityMatchMutations,
  hasAIAudit,
  type SimilarityMatchItem,
  type TriageDecision,
} from '../hooks/use-similarity-matches';

const TABS = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'AI Audit', value: 'ai_audit' },
  { label: 'HITL', value: 'hitl' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Rejected', value: 'rejected' },
];

export default function SimilarityMatchesPage() {
  const location = useLocation();
  const productIdFromQuery = useMemo(
    () => new URLSearchParams(location.search).get('productId') ?? undefined,
    [location.search]
  );
  const [activeTab, setActiveTab] = useState('all');
  const [filters, setFilters] = useState<SimilarityMatchesFilterState>({
    similarityMin: 0.9,
    similarityMax: 1,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<{
    key: 'score' | 'created' | 'product';
    direction: 'asc' | 'desc';
  }>({
    key: 'created',
    direction: 'desc',
  });
  const [page, setPage] = useState(1);
  const [drawerMatch, setDrawerMatch] = useState<SimilarityMatchItem | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const prevMatchesRef = useRef<SimilarityMatchItem[]>([]);

  useEffect(() => {
    if (!productIdFromQuery) return;
    setFilters((prev) => ({ ...prev, productId: productIdFromQuery }));
  }, [productIdFromQuery]);

  const derivedFilters = useMemo(() => {
    if (activeTab === 'pending') return { ...filters, status: ['pending'] };
    if (activeTab === 'confirmed') return { ...filters, status: ['confirmed'] };
    if (activeTab === 'rejected') return { ...filters, status: ['rejected'] };
    if (activeTab === 'ai_audit')
      return { ...filters, triageDecision: ['ai_audit'] as TriageDecision[] };
    if (activeTab === 'hitl')
      return { ...filters, triageDecision: ['hitl_required'] as TriageDecision[] };
    return filters;
  }, [activeTab, filters]);

  const { matches, loading, error, reload } = useSimilarityMatches(derivedFilters);
  const stats = useSimilarityMatchesStats(matches);
  const { updateConfidence, batchUpdateConfidence, markAsPrimary } = useSimilarityMatchMutations();

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      void reload();
    }, 60000);
    return () => clearInterval(timer);
  }, [autoRefresh, reload]);

  useEffect(() => {
    const prev = prevMatchesRef.current;
    if (prev.length > 0 && matches.length > 0) {
      const prevMap = new Map(prev.map((item) => [item.id, item]));
      matches.forEach((match) => {
        const before = prevMap.get(match.id);
        if (!before) return;
        if (!hasAIAudit(before) && hasAIAudit(match)) {
          toast.info(`AI Audit completat pentru ${match.product_title}`);
        }
      });
    }
    prevMatchesRef.current = matches;
  }, [matches]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => matches.some((match) => match.id === id)));
  }, [matches]);

  const sorted = useMemo(() => {
    const items = [...matches];
    items.sort((a, b) => {
      if (sortBy.key === 'score') {
        const diff = Number(a.similarity_score) - Number(b.similarity_score);
        return sortBy.direction === 'asc' ? diff : -diff;
      }
      if (sortBy.key === 'product') {
        const diff = a.product_title.localeCompare(b.product_title);
        return sortBy.direction === 'asc' ? diff : -diff;
      }
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortBy.direction === 'asc' ? diff : -diff;
    });
    return items;
  }, [matches, sortBy]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const visible = sorted.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleConfirm = async (matchId: string) => {
    try {
      await updateConfidence(matchId, 'confirmed');
      toast.success('Match confirmat.');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nu am putut confirma match-ul.');
    }
  };

  const handleReject = async (matchId: string) => {
    try {
      await updateConfidence(matchId, 'rejected');
      toast.success('Match respins.');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nu am putut respinge match-ul.');
    }
  };

  const exportCsv = () => {
    const headers = [
      'product_title',
      'product_id',
      'source_title',
      'source_url',
      'similarity_score',
      'match_confidence',
      'match_method',
    ];
    const rows = sorted.map((match) => [
      match.product_title,
      match.product_id,
      match.source_title ?? '',
      match.source_url,
      match.similarity_score,
      match.match_confidence,
      match.match_method,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `similarity-matches-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'Products', href: '/products' }, { label: 'Similarity Matches' }]}
      />
      <PageHeader
        title="Similarity Matches"
        description="Revizuiește și confirmă matches externe."
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => void reload()}>
              Refresh
            </Button>
            <Button size="sm" variant="ghost" onClick={exportCsv}>
              Export CSV
            </Button>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              Auto-refresh
            </label>
          </>
        }
      />

      <Tabs
        items={TABS}
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          setPage(1);
          setSelectedIds([]);
        }}
      />

      <SimilarityMatchesStats stats={stats} />

      <SimilarityMatchesFilters
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
        onClear={() => {
          setFilters({
            similarityMin: 0.9,
            similarityMax: 1,
            ...(productIdFromQuery ? { productId: productIdFromQuery } : {}),
          });
          setPage(1);
        }}
      />

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-muted/20 bg-background p-3 text-sm">
          <span>{selectedIds.length} selectate</span>
          <button
            type="button"
            className="rounded-md border border-muted/20 px-3 py-1 text-xs"
            onClick={() => {
              void batchUpdateConfidence(selectedIds, 'confirmed').then(() => reload());
            }}
          >
            Confirm selected
          </button>
          <button
            type="button"
            className="rounded-md border border-muted/20 px-3 py-1 text-xs"
            onClick={() => {
              void batchUpdateConfidence(selectedIds, 'rejected').then(() => reload());
            }}
          >
            Reject selected
          </button>
          <button
            type="button"
            className="rounded-md border border-muted/20 px-3 py-1 text-xs"
            onClick={() => setSelectedIds([])}
          >
            Clear selection
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-error/30 bg-error/10 p-4">{error}</div>
      ) : null}
      {loading ? (
        <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
          Se încarcă similarity matches...
        </div>
      ) : null}

      <div className="md:hidden space-y-3">
        {visible.map((match) => (
          <SimilarityMatchCard
            key={match.id}
            match={match}
            onClick={() => setDrawerMatch(match)}
            onQuickConfirm={() => void handleConfirm(match.id)}
            onQuickReject={() => void handleReject(match.id)}
          />
        ))}
      </div>

      <div className="hidden md:block">
        <SimilarityMatchesTable
          matches={visible}
          selectedIds={selectedIds}
          onToggleSelect={(id) =>
            setSelectedIds((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
            )
          }
          onToggleSelectAll={(ids) =>
            setSelectedIds((prev) => (prev.length === ids.length ? [] : ids))
          }
          onConfirm={(matchId) => {
            void handleConfirm(matchId);
          }}
          onReject={(matchId) => {
            void handleReject(matchId);
          }}
          onRowClick={(match) => setDrawerMatch(match)}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          Page {page} / {totalPages} • {sorted.length} results
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border border-muted/20 px-2 py-1"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page === 1}
          >
            Prev
          </button>
          <button
            type="button"
            className="rounded-md border border-muted/20 px-2 py-1"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={page === totalPages}
          >
            Next
          </button>
        </div>
      </div>

      <SimilarityMatchDetailDrawer
        match={drawerMatch}
        isOpen={Boolean(drawerMatch)}
        onClose={() => setDrawerMatch(null)}
        onConfirm={() => {
          if (!drawerMatch) return;
          void handleConfirm(drawerMatch.id);
        }}
        onReject={() => {
          if (!drawerMatch) return;
          void handleReject(drawerMatch.id);
        }}
        onMarkAsPrimary={() => {
          if (!drawerMatch) return;
          void markAsPrimary(drawerMatch.id).then(() => reload());
        }}
      />
    </div>
  );
}
