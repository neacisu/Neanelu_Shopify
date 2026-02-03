import { Button } from '../ui/button';
import { MatchStatusBadge } from './MatchStatusBadge';
import { TriageStatusBadge } from './TriageStatusBadge';

import type { SimilarityMatchItem } from '../../hooks/use-similarity-matches';
import { getScoreBreakdown, getTriageDecision } from '../../hooks/use-similarity-matches';

interface SimilarityMatchesTableProps {
  matches: SimilarityMatchItem[];
  selectedIds: string[];
  onToggleSelect: (matchId: string) => void;
  onToggleSelectAll: (matchIds: string[]) => void;
  onConfirm: (matchId: string) => void;
  onReject: (matchId: string) => void;
  onRowClick?: (match: SimilarityMatchItem) => void;
  sortBy: { key: 'score' | 'created' | 'product'; direction: 'asc' | 'desc' };
  onSortChange: (sort: { key: 'score' | 'created' | 'product'; direction: 'asc' | 'desc' }) => void;
}

export function SimilarityMatchesTable({
  matches,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onConfirm,
  onReject,
  onRowClick,
  sortBy,
  onSortChange,
}: SimilarityMatchesTableProps) {
  const allSelected = matches.length > 0 && selectedIds.length === matches.length;
  const toggleSort = (key: 'score' | 'created' | 'product') => {
    if (sortBy.key === key) {
      onSortChange({ key, direction: sortBy.direction === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ key, direction: 'desc' });
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-muted/20">
      <table className="min-w-full text-sm">
        <thead className="bg-muted/10 text-left text-caption text-muted">
          <tr>
            <th className="px-4 py-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onToggleSelectAll(matches.map((item) => item.id))}
              />
            </th>
            <th className="px-4 py-3">
              <button type="button" onClick={() => toggleSort('product')}>
                Product
              </button>
            </th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">
              <button type="button" onClick={() => toggleSort('score')}>
                Score
              </button>
            </th>
            <th className="px-4 py-3">Method</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Triage</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => (
            <tr
              key={match.id}
              className="border-t border-muted/10 hover:bg-muted/5"
              onClick={() => onRowClick?.(match)}
            >
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(match.id)}
                  onChange={(event) => {
                    event.stopPropagation();
                    onToggleSelect(match.id);
                  }}
                />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {match.product_image ? (
                    <img
                      src={match.product_image}
                      alt={match.product_title}
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-muted/20" />
                  )}
                  <div>
                    <div className="text-body">{match.product_title}</div>
                    <div className="text-xs text-muted">{match.source_brand ?? '—'}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-body">{match.source_title ?? match.source_url}</div>
                <div className="text-xs text-muted">{match.source_url}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-body">{Number(match.similarity_score).toFixed(2)}</div>
                <div className="mt-1 h-1.5 w-24 rounded-full bg-muted/20">
                  <div
                    className="h-1.5 rounded-full bg-primary/70"
                    style={{ width: `${Math.min(Number(match.similarity_score) * 100, 100)}%` }}
                  />
                </div>
                {getScoreBreakdown(match) ? (
                  <div className="mt-1 text-xs text-muted">Scoring breakdown</div>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-muted/20 px-2 py-1 text-xs text-muted">
                  {match.match_method}
                </span>
              </td>
              <td className="px-4 py-3">
                <MatchStatusBadge
                  status={
                    match.match_confidence === 'pending' ||
                    match.match_confidence === 'confirmed' ||
                    match.match_confidence === 'rejected' ||
                    match.match_confidence === 'uncertain'
                      ? match.match_confidence
                      : 'pending'
                  }
                />
              </td>
              <td className="px-4 py-3">
                {getTriageDecision(match) ? (
                  <TriageStatusBadge status={getTriageDecision(match) ?? 'rejected'} />
                ) : (
                  <span className="text-xs text-muted">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(event) => {
                      event.stopPropagation();
                      onConfirm(match.id);
                    }}
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      onReject(match.id);
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {matches.length === 0 ? (
            <tr>
              <td className="px-4 py-6 text-center text-sm text-muted" colSpan={8}>
                Nu există matches pentru filtrul curent.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
