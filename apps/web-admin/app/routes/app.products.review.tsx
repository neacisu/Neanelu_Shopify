import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Button } from '../components/ui/button';
import { HITLReviewQueue } from '../components/domain/HITLReviewQueue';
import { ValueComparisonPanel } from '../components/domain/ValueComparisonPanel';
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
      { label: 'Coada review', href: location.pathname },
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
        title="Coada review"
        description="Confirmari potriviri si propuneri noi de atribute."
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={type === 'match' ? 'secondary' : 'ghost'}
          onClick={() => setType('match')}
        >
          Confirmare potriviri
        </Button>
        <Button
          size="sm"
          variant={type === 'proposal' ? 'secondary' : 'ghost'}
          onClick={() => setType('proposal')}
        >
          Atribute noi
        </Button>
        <Button
          size="sm"
          variant={type === 'hitl' ? 'secondary' : 'ghost'}
          onClick={() => setType('hitl')}
        >
          Coada HITL
        </Button>
      </div>

      <div className="rounded-lg border bg-background">
        {loading ? <div className="p-4 text-sm text-muted">Se incarca...</div> : null}
        {!loading && items.length === 0 ? (
          <div className="p-4 text-sm text-muted">
            Nu exista elemente in asteptare pentru review.
          </div>
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
                Similaritate: {item.similarity_score} • {item.source_title ?? item.source_url}
              </div>
              <div className="mt-2 text-xs text-muted">
                GTIN: {item.source_gtin ?? '-'} • Pret: {item.source_price ?? '-'}{' '}
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
                  Confirma potrivirea
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
                  Respinge
                </Button>
              </div>
            </div>
          ))
        ) : (
          (items as ReviewProposalItem[]).map((item) => (
            <div key={item.id} className="border-t p-4 text-sm">
              <div className="font-semibold">{item.product_title}</div>
              <div className="text-xs text-muted">
                {item.field_path} • Incredere: {item.confidence_score ?? '-'}
              </div>
              <ValueComparisonPanel
                currentValue={item.current_value}
                proposedValue={item.proposed_value}
              />
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
                  Aproba
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
                  Respinge
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
