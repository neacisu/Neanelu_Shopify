import { Button } from '../ui/button';

import type { SimilarityMatchItem } from '../../hooks/use-similarity-matches';

interface SimilarityMatchCardProps {
  match: SimilarityMatchItem;
  onClick?: () => void;
  onQuickConfirm?: () => void;
  onQuickReject?: () => void;
}

export function SimilarityMatchCard({
  match,
  onClick,
  onQuickConfirm,
  onQuickReject,
}: SimilarityMatchCardProps) {
  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="text-sm text-muted">{match.source_title ?? match.source_url}</div>
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
