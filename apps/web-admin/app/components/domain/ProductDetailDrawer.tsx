import type { ProductDetail } from '@app/types';
import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useApiClient } from '../../hooks/use-api';
import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';
import { JsonViewer } from '../ui/JsonViewer';
import { ConflictIndicator } from './ConflictIndicator';
import { ConsensusStatusBadge } from './ConsensusStatusBadge';
import { QualityLevelBadge } from './QualityLevelBadge';
import { ShopifyAdminLink } from './ShopifyAdminLink';

type ProductDetailDrawerProps = Readonly<{
  open: boolean;
  product: ProductDetail | null;
  onClose: () => void;
  onForceSync: () => void | Promise<void>;
  onEdit: () => void;
}>;

export function ProductDetailDrawer({
  open,
  product,
  onClose,
  onForceSync,
  onEdit,
}: ProductDetailDrawerProps) {
  const api = useApiClient();
  const navigate = useNavigate();

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open, handleEscape]);

  const [syncing, setSyncing] = useState(false);
  const [variants, setVariants] = useState(product?.variants ?? []);
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
    if (!open || !product) return;

    setVariants(product.variants);

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
  }, [api, open, product?.id]);

  if (!open || !product) return null;

  const handleForceSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await Promise.resolve(onForceSync());
      toast.success('Sync pornit');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Force Sync a esuat');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm transition-opacity duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-product-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-[500px] flex-col border-l border-white/20 bg-white/90 backdrop-blur-xl shadow-xl motion-safe:animate-[slideInRight_0.3s_ease-out] dark:border-white/10 dark:bg-slate-900/90">
        <div className="flex items-center justify-between border-b border-border dark:border-slate-700 p-4">
          <div className="space-y-1" id="drawer-product-title">
            <div className="text-sm text-muted dark:text-slate-400">Produs</div>
            <div className="text-lg font-semibold dark:text-slate-100">{product.title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label="Închide"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="flex gap-3">
            <div className="h-20 w-20 overflow-hidden rounded-md border dark:border-slate-700 bg-muted/10 dark:bg-slate-800">
              {product.featuredImageUrl ? (
                <img
                  src={product.featuredImageUrl}
                  alt={product.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted dark:text-slate-500">
                  Fără imagine
                </div>
              )}
            </div>
            <div className="space-y-1 text-sm dark:text-slate-200">
              <div>
                <span className="text-muted dark:text-slate-400">Vânzător:</span>{' '}
                {product.vendor ?? '-'}
              </div>
              <div>
                <span className="text-muted dark:text-slate-400">Status:</span>{' '}
                {product.status ?? '-'}
              </div>
              <div>
                <span className="text-muted dark:text-slate-400">Handle:</span> {product.handle}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border dark:border-slate-700 bg-muted/5 dark:bg-slate-800/50 p-3">
            <div className="text-xs font-semibold text-muted dark:text-slate-400">
              Nivel calitate
            </div>
            <div className="mt-2 flex items-center gap-3">
              <QualityLevelBadge level={product.pim?.qualityLevel ?? null} />
              <div className="text-sm text-muted dark:text-slate-400">
                Score: {product.pim?.qualityScore ?? '-'}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border dark:border-slate-700 bg-muted/5 dark:bg-slate-800/50 p-3">
            <div className="text-xs font-semibold text-muted dark:text-slate-400">
              Status consensus
            </div>
            <div className="mt-2 flex items-center gap-3">
              <ConsensusStatusBadge status="pending" />
              <ConflictIndicator count={0} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const masterId = product.pim?.masterId;
                  if (!masterId) {
                    toast.error('Produsul nu are inca PIM masterId (ruleaza Force Sync)');
                    return;
                  }
                  void navigate(`/pim/consensus?productId=${masterId}`);
                }}
              >
                Vezi detalii
              </Button>
            </div>
          </div>

          <details className="rounded-md border border-border dark:border-slate-700 p-3 transition-colors hover:bg-muted/5 dark:hover:bg-slate-800/50">
            <summary className="cursor-pointer text-sm font-semibold dark:text-slate-100">
              Variante
            </summary>
            <div className="mt-2 space-y-2 text-xs text-muted dark:text-slate-400">
              {variants.map((variant) => (
                <div key={variant.id} className="flex items-center justify-between">
                  <div>
                    {variant.sku ?? variant.title ?? 'Variantă'} /{' '}
                    {variant.barcode ?? 'Fără cod bare'}
                  </div>
                  <div>{variant.price}</div>
                </div>
              ))}
            </div>
          </details>

          <details className="rounded-md border border-border dark:border-slate-700 p-3 transition-colors hover:bg-muted/5 dark:hover:bg-slate-800/50">
            <summary className="cursor-pointer text-sm font-semibold dark:text-slate-100">
              Metafields
            </summary>
            <div className="mt-2">
              <JsonViewer value={product.metafields} />
            </div>
          </details>

          <details className="rounded-md border border-border dark:border-slate-700 p-3 transition-colors hover:bg-muted/5 dark:hover:bg-slate-800/50">
            <summary className="cursor-pointer text-sm font-semibold dark:text-slate-100">
              Istoric sincronizare
            </summary>
            <div className="mt-2 space-y-2 text-xs text-muted dark:text-slate-400">
              {events.length === 0
                ? 'Nu există istoric de sincronizare.'
                : events.map((event) => (
                    <div key={event.id}>
                      {event.event_type} → {event.new_level} ({event.quality_score_after ?? '-'})
                    </div>
                  ))}
            </div>
          </details>

          <details className="rounded-md border border-border dark:border-slate-700 p-3 transition-colors hover:bg-muted/5 dark:hover:bg-slate-800/50">
            <summary className="cursor-pointer text-sm font-semibold dark:text-slate-100">
              Surse îmbogățire
            </summary>
            <div className="mt-2 space-y-2 text-xs text-muted dark:text-slate-400">
              {matches.length === 0
                ? 'Nu există încă surse de îmbogățire.'
                : matches.map((match) => (
                    <div key={match.id}>
                      <div className="text-sm text-foreground dark:text-slate-200">
                        {match.source_title ?? match.source_url}
                      </div>
                      <div className="text-xs text-muted dark:text-slate-400">
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
                          Confirmă
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
                          Respinge
                        </Button>
                      </div>
                    </div>
                  ))}
            </div>
          </details>

          <details className="rounded-md border border-border dark:border-slate-700 p-3 transition-colors hover:bg-muted/5 dark:hover:bg-slate-800/50">
            <summary className="cursor-pointer text-sm font-semibold dark:text-slate-100">
              Sugestii AI
            </summary>
            <div className="mt-2 space-y-2 text-xs text-muted dark:text-slate-400">
              {similarProducts.length === 0
                ? 'Nu există încă produse similare.'
                : similarProducts.map((item) => (
                    <div key={item.id}>
                      {item.title} ({Math.round(item.similarity * 100)}%)
                    </div>
                  ))}
            </div>
          </details>
        </div>

        <div className="flex items-center justify-between border-t border-border dark:border-slate-700 p-4 dark:bg-slate-900">
          <span className="inline-flex items-center gap-1">
            <Button variant="secondary" onClick={() => void handleForceSync()} disabled={syncing}>
              {syncing ? 'Se sincronizează…' : 'Forțare sync'}
            </Button>
            <InfoTooltip title="Forțare sincronizare" side="top">
              Trimite produsul în coada de sincronizare cu Shopify. Datele locale vor fi actualizate
              cu cele din magazin. Util după modificări manuale sau erori de sync.
            </InfoTooltip>
          </span>
          <div className="flex gap-2">
            <ShopifyAdminLink
              resourceType="products"
              resourceId={product.id}
              title="Deschide în panoul Shopify"
            >
              Vezi în Shopify
            </ShopifyAdminLink>
            <span className="inline-flex items-center gap-1">
              <Button variant="secondary" onClick={onEdit}>
                Editează
              </Button>
              <InfoTooltip title="Editare produs" side="top">
                Deschide formularul de editare a metadatelor PIM. Poți modifica titlul master,
                descrierea, GTIN, MPN și alte câmpuri. Modificările se salvează local.
              </InfoTooltip>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
