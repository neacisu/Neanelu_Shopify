import type { ProductDetail } from '@app/types';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '../ui/button';
import { JsonViewer } from '../ui/JsonViewer';
import { QualityLevelBadge } from './QualityLevelBadge';
import { ShopifyAdminLink } from './ShopifyAdminLink';
import { useApiClient } from '../../hooks/use-api';

type ProductDetailDrawerProps = Readonly<{
  open: boolean;
  product: ProductDetail | null;
  onClose: () => void;
  onForceSync: () => void;
  onEdit: () => void;
}>;

export function ProductDetailDrawer({
  open,
  product,
  onClose,
  onForceSync,
  onEdit,
}: ProductDetailDrawerProps) {
  if (!open || !product) return null;
  const api = useApiClient();
  const [variants, setVariants] = useState(product.variants);
  const [matches, setMatches] = useState<
    {
      id: string;
      source_url: string;
      source_title: string | null;
      similarity_score: string;
      match_confidence: string;
    }[]
  >([]);
  const [events, setEvents] = useState<
    {
      id: string;
      event_type: string;
      new_level: string;
      quality_score_after: string | null;
      created_at: string;
    }[]
  >([]);
  const [similarProducts, setSimilarProducts] = useState<
    { id: string; title: string; similarity: number }[]
  >([]);

  useEffect(() => {
    if (!open) return;
    void api
      .getApi<{ variants: typeof variants }>(`/products/${product.id}/variants`)
      .then((data) => setVariants(data.variants))
      .catch(() => undefined);
    void api
      .getApi<{ matches: typeof matches }>(`/products/${product.id}/matches`)
      .then((data) => setMatches(data.matches))
      .catch(() => undefined);
    void api
      .getApi<{ events: typeof events }>(`/products/${product.id}/quality-events`)
      .then((data) => setEvents(data.events))
      .catch(() => undefined);
    void api
      .getApi<{ results: { id: string; title: string; similarity: number }[] }>(
        `/products/search?q=${encodeURIComponent(product.title)}&limit=5&threshold=0.7`
      )
      .then((data) => setSimilarProducts(data.results))
      .catch(() => undefined);
  }, [api, open, product.id]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <div className="flex h-full w-[500px] flex-col bg-background shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <div className="space-y-1">
            <div className="text-sm text-muted">Product</div>
            <div className="text-lg font-semibold">{product.title}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted/20">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="flex gap-3">
            <div className="h-20 w-20 overflow-hidden rounded-md border bg-muted/10">
              {product.featuredImageUrl ? (
                <img
                  src={product.featuredImageUrl}
                  alt={product.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted">
                  No image
                </div>
              )}
            </div>
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-muted">Vendor:</span> {product.vendor ?? '-'}
              </div>
              <div>
                <span className="text-muted">Status:</span> {product.status ?? '-'}
              </div>
              <div>
                <span className="text-muted">Handle:</span> {product.handle}
              </div>
            </div>
          </div>

          <div className="rounded-md border bg-muted/5 p-3">
            <div className="text-xs font-semibold text-muted">Quality Level</div>
            <div className="mt-2 flex items-center gap-3">
              <QualityLevelBadge level={product.pim?.qualityLevel ?? null} />
              <div className="text-sm text-muted">Score: {product.pim?.qualityScore ?? '-'}</div>
            </div>
          </div>

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-semibold">Variants</summary>
            <div className="mt-2 space-y-2 text-xs text-muted">
              {variants.map((variant) => (
                <div key={variant.id} className="flex items-center justify-between">
                  <div>
                    {variant.sku ?? variant.title ?? 'Variant'} / {variant.barcode ?? 'No barcode'}
                  </div>
                  <div>{variant.price}</div>
                </div>
              ))}
            </div>
          </details>

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-semibold">Metafields</summary>
            <div className="mt-2">
              <JsonViewer value={product.metafields} />
            </div>
          </details>

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-semibold">Sync History</summary>
            <div className="mt-2 space-y-2 text-xs text-muted">
              {events.length === 0
                ? 'No sync history available.'
                : events.map((event) => (
                    <div key={event.id}>
                      {event.event_type} → {event.new_level} ({event.quality_score_after ?? '-'})
                    </div>
                  ))}
            </div>
          </details>

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-semibold">Enrichment Sources</summary>
            <div className="mt-2 space-y-2 text-xs text-muted">
              {matches.length === 0
                ? 'No enrichment sources yet.'
                : matches.map((match) => (
                    <div key={match.id}>
                      <div className="text-sm text-foreground">
                        {match.source_title ?? match.source_url}
                      </div>
                      <div className="text-xs text-muted">
                        Similarity: {match.similarity_score} • {match.match_confidence}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            void api
                              .postApi(`/products/review/${match.id}/confirm`, {})
                              .then(() => {
                                setMatches((prev) =>
                                  prev.map((item) =>
                                    item.id === match.id
                                      ? { ...item, match_confidence: 'confirmed' }
                                      : item
                                  )
                                );
                              });
                          }}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void api.postApi(`/products/review/${match.id}/reject`, {}).then(() => {
                              setMatches((prev) =>
                                prev.map((item) =>
                                  item.id === match.id
                                    ? { ...item, match_confidence: 'rejected' }
                                    : item
                                )
                              );
                            });
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))}
            </div>
          </details>

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-semibold">AI Insights</summary>
            <div className="mt-2 space-y-2 text-xs text-muted">
              {similarProducts.length === 0
                ? 'No similar products yet.'
                : similarProducts.map((item) => (
                    <div key={item.id}>
                      {item.title} ({Math.round(item.similarity * 100)}%)
                    </div>
                  ))}
            </div>
          </details>
        </div>

        <div className="flex items-center justify-between border-t p-4">
          <Button variant="secondary" onClick={onForceSync}>
            Force Sync
          </Button>
          <div className="flex gap-2">
            <ShopifyAdminLink resourceType="products" resourceId={product.id}>
              View in Shopify
            </ShopifyAdminLink>
            <Button variant="secondary" onClick={onEdit}>
              Edit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
