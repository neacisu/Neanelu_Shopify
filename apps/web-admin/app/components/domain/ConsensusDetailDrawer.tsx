import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { Button } from '../ui/button.js';
import { Drawer } from '../ui/drawer';
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

const summaryClass =
  'interactive flex cursor-pointer select-none list-none items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-foreground hover:bg-subtle/40 [&::-webkit-details-marker]:hidden';

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
    <Drawer open={isOpen} onClose={onClose} title="Detalii consens" side="right" size="xl">
      <div className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          <ConsensusStatusBadge status={status} />
          <span>Scor: {qualityScore != null ? qualityScore.toFixed(2) : '—'}</span>
          <ConflictIndicator count={conflictsCount} />
          <div className="ml-auto flex items-center gap-2">
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

        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-border/60 p-3">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <div className="mt-3">
              <QualityScoreBreakdown breakdown={breakdown} score={qualityScore ?? null} />
            </div>
          </div>

          <details className="group rounded-md border border-border/60 p-3" open>
            <summary className={summaryClass}>
              <span>Surse</span>
              <ChevronDown
                className="size-3.5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="mt-3 overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-subtle/40">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted">Sursă</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted">Trust</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted">
                      Similaritate
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source, idx) => (
                    <tr
                      key={`${source.sourceName}-${idx}`}
                      className="table-row-interactive border-t border-border/60 text-foreground"
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

          <details className="group rounded-md border border-border/60 p-3" open>
            <summary className={summaryClass}>
              <span>Rezultate consens</span>
              <ChevronDown
                className="size-3.5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="mt-3 overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-subtle/40">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted">Atribut</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted">Valoare</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted">Surse</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted">
                      Încredere
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <tr
                      key={row.attribute}
                      className="table-row-interactive border-t border-border/60 text-foreground"
                    >
                      <td className="px-3 py-2">{row.attribute}</td>
                      <td className="px-3 py-2 text-muted">{row.value}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.sourcesCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.confidence.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {conflicts.length > 0 ? (
            <details className="group rounded-md border border-error/25 p-3" open>
              <summary className={`${summaryClass} text-error`}>
                <span>Conflicte ({conflicts.length})</span>
                <ChevronDown
                  className="size-3.5 shrink-0 text-error/60 transition-transform duration-200 group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="mt-3 space-y-4">
                {conflictPanels.map(({ conflict, options }) => (
                  <div key={conflict.attributeName} className="space-y-2">
                    <div className="text-xs text-muted">{conflict.reason}</div>
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
            <details className="group rounded-md border border-border/60 p-3" open>
              <summary className={summaryClass}>
                <span>Votare multi-sursă</span>
                <ChevronDown
                  className="size-3.5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {attributeOptions.map((attribute) => (
                  <button
                    key={attribute}
                    type="button"
                    className={`interactive rounded-full px-3 py-1 text-xs focus-ring-standard ${
                      selectedAttribute === attribute
                        ? 'bg-primary/20 text-primary ring-1 ring-primary/30'
                        : 'bg-muted/15 text-muted hover:bg-muted/25 hover:text-foreground'
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

          <details className="group rounded-md border border-border/60 p-3">
            <summary className={summaryClass}>
              <span>Cronologie proveniență</span>
              <ChevronDown
                className="size-3.5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="mt-3">
              <ProvenanceTimeline entries={provenance} />
            </div>
          </details>
        </div>
      </div>
    </Drawer>
  );
}
