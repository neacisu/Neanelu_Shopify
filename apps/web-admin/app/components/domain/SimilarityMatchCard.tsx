import { Button } from '../ui/button';
import { ExtractionStatusBadge } from './ExtractionStatusBadge';

import type { SimilarityMatchItem } from '../../hooks/use-similarity-matches';
import { getExtractionStatus, type ExtractionStatus } from '../../hooks/use-similarity-matches';

interface SimilarityMatchCardProps {
  match: SimilarityMatchItem;
  extractionStatusOverride?: ExtractionStatus;
  onClick?: () => void;
  onQuickConfirm?: () => void;
  onQuickReject?: () => void;
}

export function SimilarityMatchCard({
  match,
  extractionStatusOverride,
  onClick,
  onQuickConfirm,
  onQuickReject,
}: SimilarityMatchCardProps) {
  const extractionStatus = extractionStatusOverride ?? getExtractionStatus(match);
  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-muted">{match.source_title ?? match.source_url}</div>
        <ExtractionStatusBadge status={extractionStatus} />
      </div>
      <div className="mt-2 text-body">{Number(match.similarity_score).toFixed(2)} similarity</div>
      <div className="mt-4 flex gap-2">
        <Button size="sm" variant="secondary" onClick={onQuickConfirm ?? onClick}>
          Confirm
        </Button>
        <Button size="sm" variant="ghost" onClick={onQuickReject ?? onClick}>
          Reject
        </Button>
      </div>
    </div>
  );
}
