import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';
import { ExtractionStatusBadge } from './ExtractionStatusBadge';
import { MatchStatusBadge } from './MatchStatusBadge';
import { TriageStatusBadge } from './TriageStatusBadge';

import type { SimilarityMatchItem } from '../../hooks/use-similarity-matches';
import {
  getExtractionStatus,
  getTriageDecision,
  type ExtractionStatus,
} from '../../hooks/use-similarity-matches';

interface SimilarityMatchCardProps {
  match: SimilarityMatchItem;
  extractionStatusOverride?: ExtractionStatus;
  index?: number;
  onClick?: () => void;
  onQuickConfirm?: () => void;
  onQuickReject?: () => void;
}

export function SimilarityMatchCard({
  match,
  extractionStatusOverride,
  index = 0,
  onClick,
  onQuickConfirm,
  onQuickReject,
}: SimilarityMatchCardProps) {
  const extractionStatus = extractionStatusOverride ?? getExtractionStatus(match);
  const triage = getTriageDecision(match);
  const status =
    match.match_confidence === 'pending' ||
    match.match_confidence === 'confirmed' ||
    match.match_confidence === 'rejected' ||
    match.match_confidence === 'uncertain'
      ? match.match_confidence
      : 'pending';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className="group cursor-pointer rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 transition-all duration-200 hover:border-blue-300/60 hover:shadow-[var(--shadow-md)] hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-slate-700/60 dark:bg-slate-900/80 dark:hover:border-blue-500/40 dark:hover:bg-slate-800/90 dark:focus-visible:ring-blue-400/50"
      style={{ animation: `fadeSlideUp 0.35s ease-out ${index * 60}ms both` }}
    >
      <div className="flex items-start gap-3">
        {match.product_image ? (
          <img
            src={match.product_image}
            alt={match.product_title}
            className="h-12 w-12 shrink-0 rounded-lg object-cover motion-safe:transition-transform motion-safe:duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-800 dark:text-slate-100 line-clamp-2">
            {match.product_title}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
            {match.source_title ?? match.source_url}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-sm">
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {Number(match.similarity_score).toFixed(2)}
          </span>
          <InfoTooltip title="Scor similaritate">
            Scorul de similaritate (0–1) arată cât de bine se potrivește sursa externă cu produsul
            tău. Este important pentru a decide dacă potrivirea e validă. De exemplu, un scor de
            0.98 indică aproape certitudine. Sfat: scoruri sub 0.92 necesită verificare manuală
            atentă.
          </InfoTooltip>
        </span>
        <MatchStatusBadge status={status} />
        {triage ? <TriageStatusBadge status={triage} /> : null}
        <ExtractionStatusBadge status={extractionStatus} />
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            (onQuickConfirm ?? onClick)?.();
          }}
        >
          Confirmă
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            (onQuickReject ?? onClick)?.();
          }}
        >
          Respinge
        </Button>
      </div>
    </div>
  );
}
