import { Button } from '../ui/button';
import { AIAuditStatusPanel } from './AIAuditStatusPanel';
import { MatchStatusBadge } from './MatchStatusBadge';
import { TriageStatusBadge } from './TriageStatusBadge';

import type { SimilarityMatchItem } from '../../hooks/use-similarity-matches';
import {
  getAIAuditResult,
  getScoreBreakdown,
  getTriageDecision,
} from '../../hooks/use-similarity-matches';

interface SimilarityMatchDetailDrawerProps {
  match: SimilarityMatchItem | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onMarkAsPrimary?: () => void;
}

export function SimilarityMatchDetailDrawer({
  match,
  isOpen,
  onClose,
  onConfirm,
  onReject,
  onMarkAsPrimary,
}: SimilarityMatchDetailDrawerProps) {
  if (!isOpen || !match) return null;
  const breakdown = getScoreBreakdown(match);
  const triage = getTriageDecision(match);
  const audit = getAIAuditResult(match);
  const details = match.match_details ?? {};
  const timeline = [
    { label: 'Created', value: match.created_at },
    {
      label: 'Triage',
      value: typeof details['triage_timestamp'] === 'string' ? details['triage_timestamp'] : null,
    },
    {
      label: 'AI Audit scheduled',
      value:
        typeof details['ai_audit_scheduled_at'] === 'string'
          ? details['ai_audit_scheduled_at']
          : null,
    },
    {
      label: 'AI Audit completed',
      value:
        typeof details['ai_audit_completed_at'] === 'string'
          ? details['ai_audit_completed_at']
          : null,
    },
  ].filter((item) => item.value);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/20">
      <div className="h-full w-full max-w-2xl bg-background p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-h6">Match Details</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted">
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
              {triage ? <TriageStatusBadge status={triage} /> : null}
              <span>Score: {Number(match.similarity_score).toFixed(2)}</span>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-muted/20 p-3">
            <div className="text-xs font-semibold text-muted">Local Product</div>
            <div className="mt-3 flex items-center gap-3">
              {match.product_image ? (
                <img
                  src={match.product_image}
                  alt={match.product_title}
                  className="h-14 w-14 rounded object-cover"
                />
              ) : (
                <div className="h-14 w-14 rounded bg-muted/20" />
              )}
              <div>
                <div className="text-sm font-medium">{match.product_title}</div>
                <div className="text-xs text-muted">PIM ID: {match.product_id}</div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-muted/20 p-3">
            <div className="text-xs font-semibold text-muted">External Source</div>
            <div className="mt-3 space-y-1 text-sm">
              <div className="font-medium">{match.source_title ?? match.source_url}</div>
              <div className="text-xs text-muted">{match.source_url}</div>
              <div className="text-xs text-muted">Brand: {match.source_brand ?? '—'}</div>
              <div className="text-xs text-muted">GTIN: {match.source_gtin ?? '—'}</div>
              <div className="text-xs text-muted">
                Price: {match.source_price ?? '—'} {match.source_currency ?? ''}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-muted/20 p-3">
          <div className="text-xs font-semibold text-muted">Similarity Breakdown</div>
          {breakdown ? (
            <div className="mt-3 grid gap-2 text-xs text-muted">
              <div>GTIN match: {breakdown.gtinMatch ?? '—'}</div>
              <div>Title similarity: {breakdown.titleSimilarity ?? '—'}</div>
              <div>Brand match: {breakdown.brandMatch ?? '—'}</div>
              <div>Price proximity: {breakdown.priceProximity ?? '—'}</div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted">Breakdown indisponibil.</div>
          )}
        </div>

        <div className="mt-4">
          <AIAuditStatusPanel auditResult={audit} isProcessing={triage === 'ai_audit' && !audit} />
        </div>

        {timeline.length > 0 ? (
          <div className="mt-4 rounded-lg border border-muted/20 p-3">
            <div className="text-xs font-semibold text-muted">Timeline</div>
            <div className="mt-2 space-y-1 text-xs text-muted">
              {timeline.map((item) => (
                <div key={item.label}>
                  {item.label}: {String(item.value)}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onConfirm}>
            Confirm
          </Button>
          <Button size="sm" variant="ghost" onClick={onReject}>
            Reject
          </Button>
          {onMarkAsPrimary ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onMarkAsPrimary}
              disabled={match.match_confidence !== 'confirmed'}
            >
              Mark as Primary
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              window.open(match.source_url, '_blank', 'noopener,noreferrer');
            }}
          >
            View Source
          </Button>
        </div>
      </div>
    </div>
  );
}
