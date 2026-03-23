import { useReducedMotion } from '../../hooks/use-reduced-motion';
import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';
import { ExtractionStatusBadge } from './ExtractionStatusBadge';
import { MatchStatusBadge } from './MatchStatusBadge';
import { TriageStatusBadge } from './TriageStatusBadge';

import {
  getExtractionStatus,
  getTriageDecision,
  type ExtractionStatus,
  type SimilarityMatchItem,
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
}: Readonly<SimilarityMatchCardProps>) {
  const reducedMotion = useReducedMotion();
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
      className="group relative rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4 transition-all duration-200 hover:border-primary/30 hover:shadow-(--shadow-md) hover:bg-card/90"
      style={
        reducedMotion ? undefined : { animation: `fadeSlideUp 0.35s ease-out ${index * 60}ms both` }
      }
    >
      <button
        type="button"
        aria-label={`Detalii potrivire: ${match.product_title}`}
        onClick={onClick}
        className="absolute inset-0 cursor-pointer rounded-lg focus-ring-standard"
      />
      <div className="flex items-start gap-3">
        {match.product_image ? (
          <img
            src={match.product_image}
            alt={match.product_title}
            className="h-12 w-12 shrink-0 rounded-lg object-cover motion-safe:transition-transform motion-safe:duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="h-12 w-12 shrink-0 rounded-lg bg-subtle" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground line-clamp-2">
            {match.product_title}
          </div>
          <div className="mt-0.5 text-xs text-muted line-clamp-1">
            {match.source_title ?? match.source_url}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-sm">
          <span className="font-medium text-foreground">
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
      <div className="relative z-10 mt-4 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Confirmă potrivirea pentru ${match.product_title}`}
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
          aria-label={`Respinge potrivirea pentru ${match.product_title}`}
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
