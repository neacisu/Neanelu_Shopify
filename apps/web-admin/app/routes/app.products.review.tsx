import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Button } from '../components/ui/button';
import { HITLReviewQueue } from '../components/domain/HITLReviewQueue';
import { useApiClient } from '../hooks/use-api';

type ReviewMatchItem = Readonly<{
  id: string;
  product_id: string;
  product_title: string;
  source_url: string;
  source_title: string | null;
  source_gtin: string | null;
  source_price: string | null;
  source_currency: string | null;
  similarity_score: string;
  match_confidence: string;
  match_method?: string;
  created_at: string;
}>;

type ReviewProposalItem = Readonly<{
  id: string;
  product_id: string;
  product_title: string;
  field_path: string;
  current_value: unknown;
  proposed_value: unknown;
  confidence_score: string | null;
  proposal_status: string;
  priority: number;
  created_at: string;
}>;

export default function ProductsReviewPage() {
  const location = useLocation();
  const api = useApiClient();
  const [type, setType] = useState<'match' | 'proposal' | 'hitl'>('match');
  const [items, setItems] = useState<ReviewMatchItem[] | ReviewProposalItem[]>([]);
  const [loading, setLoading] = useState(false);

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Products', href: '/products' },
      { label: 'Review Queue', href: location.pathname },
    ],
    [location.pathname]
  );

  useEffect(() => {
    setLoading(true);
    void api
      .getApi<{ items: typeof items; type: string }>(`/products/review?type=${type}`)
      .then((data) => setItems(data.items))
      .finally(() => setLoading(false));
  }, [api, type]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader
        title="Review Queue"
        description="Review match confirmations and new attribute proposals."
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={type === 'match' ? 'secondary' : 'ghost'}
          onClick={() => setType('match')}
        >
          Match Confirmation
        </Button>
        <Button
          size="sm"
          variant={type === 'proposal' ? 'secondary' : 'ghost'}
          onClick={() => setType('proposal')}
        >
          New Attributes
        </Button>
        <Button
          size="sm"
          variant={type === 'hitl' ? 'secondary' : 'ghost'}
          onClick={() => setType('hitl')}
        >
          HITL Queue
        </Button>
      </div>

      <div className="rounded-lg border bg-background">
        {loading ? <div className="p-4 text-sm text-muted">Loading...</div> : null}
        {!loading && items.length === 0 ? (
          <div className="p-4 text-sm text-muted">No items pending review.</div>
        ) : null}

        {type === 'hitl' ? (
          <div className="p-4">
            <HITLReviewQueue
              matches={items as ReviewMatchItem[]}
              onReview={(id, decision, notes) => {
                const endpoint =
                  decision === 'confirm'
                    ? `/products/review/${id}/confirm`
                    : `/products/review/${id}/reject`;
                void api.postApi(endpoint, { reason: notes }).then(() => {
                  setItems((prev) =>
                    (prev as ReviewMatchItem[]).filter((entry) => entry.id !== id)
                  );
                });
              }}
              onSkip={(id) => {
                setItems((prev) => (prev as ReviewMatchItem[]).filter((entry) => entry.id !== id));
              }}
            />
          </div>
        ) : type === 'match' ? (
          (items as ReviewMatchItem[]).map((item) => (
            <div key={item.id} className="border-t p-4 text-sm">
              <div className="font-semibold">{item.product_title}</div>
              <div className="text-xs text-muted">
                Similarity: {item.similarity_score} • {item.source_title ?? item.source_url}
              </div>
              <div className="mt-2 text-xs text-muted">
                GTIN: {item.source_gtin ?? '-'} • Price: {item.source_price ?? '-'}{' '}
                {item.source_currency ?? ''}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void api.postApi(`/products/review/${item.id}/confirm`, {}).then(() => {
                      setItems((prev) =>
                        (prev as ReviewMatchItem[]).filter((entry) => entry.id !== item.id)
                      );
                    });
                  }}
                >
                  Confirm Match
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void api.postApi(`/products/review/${item.id}/reject`, {}).then(() => {
                      setItems((prev) =>
                        (prev as ReviewMatchItem[]).filter((entry) => entry.id !== item.id)
                      );
                    });
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))
        ) : (
          (items as ReviewProposalItem[]).map((item) => (
            <div key={item.id} className="border-t p-4 text-sm">
              <div className="font-semibold">{item.product_title}</div>
              <div className="text-xs text-muted">
                {item.field_path} • Confidence: {item.confidence_score ?? '-'}
              </div>
              <div className="mt-2 text-xs text-muted">
                Current: {JSON.stringify(item.current_value)} → Proposed:{' '}
                {JSON.stringify(item.proposed_value)}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void api.postApi(`/products/proposals/${item.id}/approve`, {}).then(() => {
                      setItems((prev) =>
                        (prev as ReviewProposalItem[]).filter((entry) => entry.id !== item.id)
                      );
                    });
                  }}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void api.postApi(`/products/proposals/${item.id}/reject`, {}).then(() => {
                      setItems((prev) =>
                        (prev as ReviewProposalItem[]).filter((entry) => entry.id !== item.id)
                      );
                    });
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
