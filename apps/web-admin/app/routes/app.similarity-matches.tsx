import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { Tabs } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { useApiClient } from '../hooks/use-api';
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
  getExtractionStatus,
  type SimilarityMatchItem,
  type TriageDecision,
  type ExtractionStatus,
} from '../hooks/use-similarity-matches';

const TAB_TOOLTIPS: Record<string, { title: string; body: string }> = {
  all: {
    title: 'Toate potrivirile',
    body: 'Afișează toate potrivirile, indiferent de status. Include potriviri confirmate, respinse și în așteptare. Util pentru o imagine de ansamblu completă. Sfat: folosește filtrele pentru a restrânge lista.',
  },
  pending: {
    title: 'În așteptare',
    body: 'Potriviri care nu au fost încă evaluate. Acestea necesită atenția ta — confirmă sau respinge fiecare. De exemplu, verifică dacă sursa externă corespunde produsului. Sfat: începe cu scorurile cele mai mari.',
  },
  ai_audit: {
    title: 'AI Audit',
    body: 'Potriviri trimise la evaluare automată de AI. AI-ul analizează titlul, brandul și prețul pentru a sugera o decizie. De exemplu, un scor de 0.97 cu brand identic va fi aprobat automat. Sfat: revizuiește rezultatele AI pentru cazuri limită.',
  },
  hitl: {
    title: 'HITL',
    body: 'Potriviri care necesită review uman (Human-in-the-Loop). AI-ul nu a fost suficient de sigur pentru a decide automat. De exemplu, branduri similare dar nu identice. Sfat: acordă prioritate celor cu scor peste 0.95.',
  },
  confirmed: {
    title: 'Confirmate',
    body: 'Potriviri validate ca fiind corecte. Datele lor pot fi folosite pentru enrichment-ul produselor. De exemplu, prețuri competitive sau specificații tehnice. Sfat: verifică periodic dacă nu apar duplicate.',
  },
  rejected: {
    title: 'Respinse',
    body: 'Potriviri respinse ca fiind incorecte sau irelevante. Nu vor fi folosite pentru enrichment. De exemplu, produse cu titlu similar dar categorie diferită. Sfat: revizuiește ocazional — pot fi erori.',
  },
};

const TABS = [
  { label: 'Toate', value: 'all' },
  { label: 'În așteptare', value: 'pending' },
  { label: 'AI Audit', value: 'ai_audit' },
  { label: 'HITL', value: 'hitl' },
  { label: 'Confirmate', value: 'confirmed' },
  { label: 'Respinse', value: 'rejected' },
];

export default function SimilarityMatchesPage() {
  const location = useLocation();
  const api = useApiClient();
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
  const [visibleCount, setVisibleCount] = useState(20);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [drawerMatch, setDrawerMatch] = useState<SimilarityMatchItem | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [extractionOverrides, setExtractionOverrides] = useState<
    Record<string, { status: ExtractionStatus; error?: string }>
  >({});
  const prevMatchesRef = useRef<SimilarityMatchItem[]>([]);
  const drawerMetricsRef = useRef<{
    matchId: string;
    openedAt: number;
    acted: boolean;
  } | null>(null);

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
  const { updateConfidence, batchUpdateConfidence, markAsPrimary, triggerExtraction } =
    useSimilarityMatchMutations();

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
    if (matches.length === 0) return;
    setExtractionOverrides((prev) => {
      const next: Record<string, { status: ExtractionStatus; error?: string }> = { ...prev };
      matches.forEach((match) => {
        if (!next[match.id]) return;
        if (getExtractionStatus(match) === 'complete') {
          delete next[match.id];
        }
      });
      return next;
    });
  }, [matches]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => matches.some((match) => match.id === id)));
  }, [matches]);

  const trackUxEvent = (name: string, payload: Record<string, unknown> = {}) => {
    // Fire-and-forget: UX tracking must never block the UI.
    void api
      .postApi<{ ok: boolean }, Record<string, unknown>>('/ux/events', {
        name,
        payload,
        resourceType: 'similarity_match',
        ...(typeof payload['matchId'] === 'string' ? { resourceId: payload['matchId'] } : {}),
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    if (drawerMatch) {
      drawerMetricsRef.current = {
        matchId: drawerMatch.id,
        openedAt: performance.now(),
        acted: false,
      };
      trackUxEvent('drawer_open', { matchId: drawerMatch.id });
    } else if (drawerMetricsRef.current) {
      if (!drawerMetricsRef.current.acted) {
        const durationMs = performance.now() - drawerMetricsRef.current.openedAt;
        trackUxEvent('drawer_abandon', {
          matchId: drawerMetricsRef.current.matchId,
          durationMs: Math.round(durationMs),
        });
      }
      drawerMetricsRef.current = null;
    }
  }, [drawerMatch]);

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
  const hasMore = visibleCount < sorted.length;
  const visible = sorted.slice(0, visibleCount);
  const [contentRef, contentVisible] = useScrollReveal<HTMLDivElement>({
    rootMargin: '0px 0px -40px 0px',
  });

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + pageSize, sorted.length));
  }, [sorted.length]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '100px', threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMore]);

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [activeTab, filters]);

  const handleConfirm = async (matchId: string) => {
    try {
      await updateConfidence(matchId, 'confirmed');
      toast.success('Match confirmat.');
      trackUxEvent('match_confirm', { matchId });
      if (drawerMetricsRef.current?.matchId === matchId) {
        drawerMetricsRef.current.acted = true;
      }
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nu am putut confirma match-ul.');
    }
  };

  const handleReject = async (matchId: string) => {
    try {
      await updateConfidence(matchId, 'rejected');
      toast.success('Match respins.');
      trackUxEvent('match_reject', { matchId });
      if (drawerMetricsRef.current?.matchId === matchId) {
        drawerMetricsRef.current.acted = true;
      }
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nu am putut respinge match-ul.');
    }
  };

  const handleExtract = async (matchId: string) => {
    setExtractionOverrides((prev) => ({
      ...prev,
      [matchId]: { status: 'in_progress' },
    }));
    try {
      await triggerExtraction(matchId);
      toast.info('Extracția a fost programată. Rezultatele vor apărea în câteva momente.');
      trackUxEvent('extract_start', { matchId });
      if (drawerMetricsRef.current?.matchId === matchId) {
        drawerMetricsRef.current.acted = true;
      }
      setTimeout(() => {
        void reload();
      }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nu am putut porni extracția xAI.';
      setExtractionOverrides((prev) => ({
        ...prev,
        [matchId]: { status: 'failed', error: message },
      }));
      trackUxEvent('extract_fail', { matchId, message });
      toast.error(message);
    }
  };

  const extractionStatusMap = useMemo(() => {
    const map: Record<string, ExtractionStatus> = {};
    matches.forEach((match) => {
      map[match.id] = extractionOverrides[match.id]?.status ?? getExtractionStatus(match);
    });
    return map;
  }, [extractionOverrides, matches]);

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
    <div
      ref={contentRef}
      className="space-y-6"
      style={{
        animation: contentVisible ? 'fadeSlideUp 0.4s ease-out both' : 'none',
      }}
    >
      <Breadcrumbs
        items={[{ label: 'Produse', href: '/products' }, { label: 'Potriviri similare' }]}
      />
      <PageHeader
        title="Potriviri similare"
        description="Revizuiește și confirmă potrivirile externe găsite pentru produse."
        actions={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => void reload()}>
                Reîncarcă
              </Button>
              <InfoTooltip title="Reîncarcă" side="bottom">
                Reîmprospătează lista de potriviri cu datele curente de pe server. Util după ce ai
                confirmat sau respins potriviri și vrei să vezi starea actualizată.
              </InfoTooltip>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={exportCsv}>
                Export CSV
              </Button>
              <InfoTooltip title="Export CSV" side="bottom">
                Descarcă potrivirile afișate (după filtre) într-un fișier CSV. Include titlu produs,
                sursă, scor similaritate și status. Util pentru raportare sau analiză offline.
              </InfoTooltip>
            </span>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={autoRefresh}
                aria-label="Activează auto-refresh"
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              <span className="flex items-center gap-1.5">
                Auto-reîncarcare
                <InfoTooltip title="Auto-reîncarcare" side="bottom">
                  Reîncarcă automat lista la fiecare 60 de secunde. Util când ai deschis pagina și
                  aștepți să apară potriviri noi sau să se actualizeze statusul după AI Audit.
                </InfoTooltip>
              </span>
            </label>
          </>
        }
      />

      <div className="flex items-center gap-2">
        <Tabs
          items={TABS}
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value);
            setVisibleCount(pageSize);
            setSelectedIds([]);
          }}
        />
        {(() => {
          const tip = TAB_TOOLTIPS[activeTab];
          return tip != null ? (
            <InfoTooltip title={tip.title} side="bottom">
              {tip.body}
            </InfoTooltip>
          ) : null;
        })()}
      </div>

      <SimilarityMatchesStats stats={stats} />

      <SimilarityMatchesFilters
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          setVisibleCount(pageSize);
        }}
        onClear={() => {
          setFilters({
            similarityMin: 0.9,
            similarityMax: 1,
            ...(productIdFromQuery ? { productId: productIdFromQuery } : {}),
          });
          setVisibleCount(pageSize);
        }}
      />

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-3 text-sm dark:border-slate-700/60 dark:bg-slate-900/80 dark:text-slate-200">
          <span>{selectedIds.length} selectate</span>
          <button
            type="button"
            className="rounded-md border border-slate-200 px-3 py-1 text-xs transition-shadow duration-200 hover:shadow-[var(--shadow-sm)] focus:ring-2 focus:ring-blue-500/40 focus:outline-none dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:ring-blue-400/50"
            onClick={() => {
              void batchUpdateConfidence(selectedIds, 'confirmed').then(() => reload());
            }}
          >
            Confirma selectate
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-200 px-3 py-1 text-xs transition-shadow duration-200 hover:shadow-[var(--shadow-sm)] focus:ring-2 focus:ring-blue-500/40 focus:outline-none dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:ring-blue-400/50"
            onClick={() => {
              void batchUpdateConfidence(selectedIds, 'rejected').then(() => reload());
            }}
          >
            Respinge selectate
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-200 px-3 py-1 text-xs transition-shadow duration-200 hover:shadow-[var(--shadow-sm)] focus:ring-2 focus:ring-blue-500/40 focus:outline-none dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:ring-blue-400/50"
            onClick={() => setSelectedIds([])}
          >
            Curăță selecția
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200/80 bg-red-50/80 p-4 text-red-800 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={`skeleton-${index}`}
              className="rounded-md border border-slate-200/60 bg-slate-100/50 p-4 text-sm text-slate-400 dark:border-slate-700/40 dark:bg-slate-800/50 dark:text-slate-500"
              style={{
                animation: `pulse 2s cubic-bezier(0.4, 0, 0.6, 1) ${index * 100}ms infinite`,
              }}
            >
              Se încarcă potrivirile...
            </div>
          ))}
        </div>
      ) : null}

      <div className="md:hidden space-y-3">
        {visible.map((match, idx) => (
          <SimilarityMatchCard
            key={match.id}
            match={match}
            index={idx}
            extractionStatusOverride={extractionStatusMap[match.id] ?? getExtractionStatus(match)}
            onClick={() => setDrawerMatch(match)}
            onQuickConfirm={() => void handleConfirm(match.id)}
            onQuickReject={() => void handleReject(match.id)}
          />
        ))}
        {!loading && visible.length === 0 ? (
          <div className="rounded-md border border-slate-200/60 bg-slate-50/50 p-4 text-sm text-slate-500 dark:border-slate-700/40 dark:bg-slate-800/50 dark:text-slate-400">
            Nu există matches pentru filtrul curent. Ajustează filtrele sau încearcă un search nou.
          </div>
        ) : null}
      </div>

      <div className="hidden md:block">
        <SimilarityMatchesTable
          matches={visible}
          selectedIds={selectedIds}
          extractionStatusMap={extractionStatusMap}
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

      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>
          {visible.length} din {sorted.length} potriviri afișate
        </span>
        {hasMore ? (
          <button
            type="button"
            className="rounded-md border border-slate-200 px-3 py-1.5 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            onClick={loadMore}
          >
            Încarcă mai multe
          </button>
        ) : null}
      </div>

      <div ref={loadMoreRef} className="h-4" aria-hidden />

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
        onExtract={() => {
          if (!drawerMatch) return;
          void handleExtract(drawerMatch.id);
        }}
        isExtracting={
          drawerMatch
            ? (extractionStatusMap[drawerMatch.id] ?? getExtractionStatus(drawerMatch)) ===
              'in_progress'
            : false
        }
        {...(drawerMatch
          ? {
              extractionStatusOverride:
                extractionStatusMap[drawerMatch.id] ?? getExtractionStatus(drawerMatch),
            }
          : {})}
        extractionError={drawerMatch ? (extractionOverrides[drawerMatch.id]?.error ?? null) : null}
      />
    </div>
  );
}
