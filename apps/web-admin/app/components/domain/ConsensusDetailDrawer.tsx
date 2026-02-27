import { useEffect, useMemo, useState } from 'react';

import { Button } from '../ui/button';
import { ConsensusStatusBadge } from './ConsensusStatusBadge';
import { TrustScoreBadge } from './TrustScoreBadge';
import { ConflictIndicator } from './ConflictIndicator';
import { QualityScoreBreakdown } from './QualityScoreBreakdown';
import { ProvenanceTimeline } from './ProvenanceTimeline';
import { ConflictResolutionPanel } from './ConflictResolutionPanel';
import { MultiSourceVotingView } from './MultiSourceVotingView';

const toDisplayValue = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value ?? null);

type ConsensusSource = Readonly<{
  sourceName: string;
  trustScore: number;
  similarityScore: number;
  status: string;
}>;

type ConsensusResultRow = Readonly<{
  attribute: string;
  value: string;
  sourcesCount: number;
  confidence: number;
}>;

type ConflictRow = Readonly<{
  attributeName: string;
  reason: string;
  values: readonly Readonly<{
    value: unknown;
    sourceName: string;
    trustScore: number;
    similarityScore: number;
  }>[];
}>;

type ProvenanceEntry = Readonly<{
  attributeName: string;
  sourceName: string;
  resolvedAt: string;
}>;

type ConsensusDetailDrawerProps = Readonly<{
  isOpen: boolean;
  onClose: () => void;
  onRecompute?: () => void;
  isRecomputing?: boolean;
  onExport?: () => void;
  onViewProduct?: () => void;
  onResolveConflict?: (attributeName: string, value: unknown) => void;
  title: string;
  status: 'pending' | 'computed' | 'conflicts' | 'manual_review';
  qualityScore: number | null;
  conflictsCount: number;
  breakdown: {
    completeness: number;
    accuracy: number;
    consistency: number;
    sourceWeight: number;
  } | null;
  sources: readonly ConsensusSource[];
  results: readonly ConsensusResultRow[];
  conflicts: readonly ConflictRow[];
  provenance: readonly ProvenanceEntry[];
  votesByAttribute: Record<
    string,
    readonly {
      value: unknown;
      attributeName: string;
      sourceName: string;
      trustScore: number;
      similarityScore: number;
      matchId: string;
    }[]
  >;
}>;

export function ConsensusDetailDrawer({
  isOpen,
  onClose,
  onRecompute,
  isRecomputing,
  onExport,
  onViewProduct,
  onResolveConflict,
  title,
  status,
  qualityScore,
  conflictsCount,
  breakdown,
  sources,
  results,
  conflicts,
  provenance,
  votesByAttribute,
}: ConsensusDetailDrawerProps) {
  if (!isOpen) return null;

  const attributeOptions = useMemo(() => {
    const fromResults = results.map((row) => row.attribute);
    const fromConflicts = conflicts.map((conflict) => conflict.attributeName);
    return Array.from(new Set([...fromResults, ...fromConflicts]));
  }, [conflicts, results]);

  const [selectedAttribute, setSelectedAttribute] = useState<string | null>(
    attributeOptions[0] ?? null
  );

  useEffect(() => {
    if (attributeOptions.length === 0) {
      setSelectedAttribute(null);
      return;
    }
    if (!selectedAttribute || !attributeOptions.includes(selectedAttribute)) {
      setSelectedAttribute(attributeOptions[0] ?? null);
    }
  }, [attributeOptions, selectedAttribute]);

  const selectedVotes = useMemo(() => {
    if (!selectedAttribute) return [];
    const votes = votesByAttribute[selectedAttribute] ?? [];
    return votes.map((vote) => ({
      sourceName: vote.sourceName,
      value: toDisplayValue(vote.value),
      trustScore: vote.trustScore,
      similarityScore: vote.similarityScore,
    }));
  }, [selectedAttribute, votesByAttribute]);

  const conflictPanels = useMemo(() => {
    return conflicts.map((conflict) => {
      const grouped = new Map<
        string,
        { label: string; value: unknown; weight: number; sourcesCount: number; trustAvg: number }
      >();
      for (const entry of conflict.values) {
        const key = JSON.stringify(entry.value ?? null);
        const existing = grouped.get(key) ?? {
          label: toDisplayValue(entry.value ?? '-'),
          value: entry.value,
          weight: 0,
          sourcesCount: 0,
          trustAvg: 0,
        };
        const weight = entry.trustScore * entry.similarityScore;
        grouped.set(key, {
          ...existing,
          weight: existing.weight + weight,
          sourcesCount: existing.sourcesCount + 1,
          trustAvg: existing.trustAvg + entry.trustScore,
        });
      }
      const options = Array.from(grouped.values()).map((opt) => ({
        label: opt.label,
        value: toDisplayValue(opt.value ?? ''),
        weight: opt.weight,
        sourcesCount: opt.sourcesCount,
        trustAvg: opt.sourcesCount ? opt.trustAvg / opt.sourcesCount : 0,
      }));

      return { conflict, options };
    });
  }, [conflicts]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out_both]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consensus-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="h-full w-full max-w-3xl border-l border-white/20 bg-white/90 backdrop-blur-xl p-4 shadow-xl animate-[slide-in-right_0.25s_ease-out_both] dark:border-white/10 dark:bg-slate-900/90"
        style={{ animationFillMode: 'both' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div id="consensus-drawer-title" className="text-h6 text-slate-800 dark:text-slate-100">
              Detalii consens
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <ConsensusStatusBadge status={status} />
              <span>Scor: {qualityScore != null ? qualityScore.toFixed(2) : '—'}</span>
              <ConflictIndicator count={conflictsCount} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Închide
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={onRecompute}
              disabled={!onRecompute || isRecomputing}
            >
              {isRecomputing ? 'Recalculez…' : 'Recalculează'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onExport} disabled={!onExport}>
              Exportă
            </Button>
            <Button size="sm" variant="ghost" onClick={onViewProduct} disabled={!onViewProduct}>
              Vezi produsul
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-4 overflow-y-auto">
          <div className="rounded-md border border-muted/20 p-3 dark:border-slate-700">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</div>
            <div className="mt-3">
              <QualityScoreBreakdown breakdown={breakdown} score={qualityScore ?? null} />
            </div>
          </div>

          <details className="rounded-md border border-muted/20 p-3 dark:border-slate-700" open>
            <summary className="cursor-pointer text-sm font-semibold text-slate-800 dark:text-slate-100">
              Surse
            </summary>
            <div className="mt-3 overflow-hidden rounded-md border border-muted/20 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Sursă</th>
                    <th className="px-3 py-2 text-right font-medium">Trust</th>
                    <th className="px-3 py-2 text-right font-medium">Similaritate</th>
                    <th className="px-3 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source, idx) => (
                    <tr
                      key={`${source.sourceName}-${idx}`}
                      className="border-t border-muted/20 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                    >
                      <td className="px-3 py-2">{source.sourceName}</td>
                      <td className="px-3 py-2 text-right">
                        <TrustScoreBadge score={source.trustScore} />
                      </td>
                      <td className="px-3 py-2 text-right">{source.similarityScore.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">{source.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details className="rounded-md border border-muted/20 p-3 dark:border-slate-700" open>
            <summary className="cursor-pointer text-sm font-semibold text-slate-800 dark:text-slate-100">
              Rezultate consens
            </summary>
            <div className="mt-3 overflow-hidden rounded-md border border-muted/20 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Atribut</th>
                    <th className="px-3 py-2 text-left font-medium">Valoare</th>
                    <th className="px-3 py-2 text-right font-medium">Surse</th>
                    <th className="px-3 py-2 text-right font-medium">Încredere</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <tr
                      key={row.attribute}
                      className="border-t border-muted/20 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                    >
                      <td className="px-3 py-2">{row.attribute}</td>
                      <td className="px-3 py-2">{row.value}</td>
                      <td className="px-3 py-2 text-right">{row.sourcesCount}</td>
                      <td className="px-3 py-2 text-right">{row.confidence.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {conflicts.length > 0 ? (
            <details className="rounded-md border border-muted/20 p-3 dark:border-slate-700" open>
              <summary className="cursor-pointer text-sm font-semibold text-slate-800 dark:text-slate-100">
                Conflicte
              </summary>
              <div className="mt-3 space-y-4">
                {conflictPanels.map(({ conflict, options }) => (
                  <div key={conflict.attributeName} className="space-y-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {conflict.reason}
                    </div>
                    <ConflictResolutionPanel
                      attributeName={conflict.attributeName}
                      options={options}
                      onSelect={(value) => onResolveConflict?.(conflict.attributeName, value)}
                    />
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {selectedAttribute ? (
            <details className="rounded-md border border-muted/20 p-3 dark:border-slate-700" open>
              <summary className="cursor-pointer text-sm font-semibold text-slate-800 dark:text-slate-100">
                Votare multi-sursă
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {attributeOptions.map((attribute) => (
                  <button
                    key={attribute}
                    type="button"
                    className={`rounded-full px-3 py-1 text-xs transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50 ${
                      selectedAttribute === attribute
                        ? 'bg-primary/20 text-primary dark:bg-primary/30'
                        : 'bg-muted/20 text-muted dark:bg-slate-700 dark:text-slate-400'
                    }`}
                    onClick={() => setSelectedAttribute(attribute)}
                  >
                    {attribute}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <MultiSourceVotingView attributeName={selectedAttribute} votes={selectedVotes} />
              </div>
            </details>
          ) : null}

          <details className="rounded-md border border-muted/20 p-3 dark:border-slate-700">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800 dark:text-slate-100">
              Cronologie proveniență
            </summary>
            <div className="mt-3">
              <ProvenanceTimeline entries={provenance} />
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
