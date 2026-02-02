import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import type { ProductDetail } from '@app/types';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Timeline } from '../components/ui/Timeline';
import { JsonViewer } from '../components/ui/JsonViewer';
import { Button } from '../components/ui/button';
import { QualityLevelBadge } from '../components/domain/QualityLevelBadge';
import { useApiClient } from '../hooks/use-api';

export default function ProductDetailPage() {
  const location = useLocation();
  const params = useParams<{ id: string }>();
  const api = useApiClient();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [variants, setVariants] = useState<ProductDetail['variants']>([]);
  const [matches, setMatches] = useState<
    { id: string; source_url: string; source_title: string | null; similarity_score: string }[]
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
  const variantsRef = useRef<HTMLDivElement | null>(null);
  const matchesRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const aiRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Products', href: '/products' },
      { label: product?.title ?? 'Details', href: location.pathname },
    ],
    [location.pathname, product?.title]
  );

  useEffect(() => {
    const id = params.id;
    if (!id) return;
    setLoading(true);
    void api
      .getApi<ProductDetail>(`/products/${id}?includeVariants=false`)
      .then((data) => setProduct(data))
      .finally(() => setLoading(false));
  }, [api, params.id]);

  useEffect(() => {
    if (!product) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          if (entry.target === variantsRef.current && variants.length === 0) {
            void api
              .getApi<{ variants: ProductDetail['variants'] }>(`/products/${product.id}/variants`)
              .then((data) => setVariants(data.variants));
          }
          if (entry.target === matchesRef.current && matches.length === 0) {
            void api
              .getApi<{ matches: typeof matches }>(`/products/${product.id}/matches`)
              .then((data) => setMatches(data.matches));
          }
          if (entry.target === historyRef.current && events.length === 0) {
            void api
              .getApi<{ events: typeof events }>(`/products/${product.id}/quality-events`)
              .then((data) => setEvents(data.events));
          }
          if (entry.target === aiRef.current && similarProducts.length === 0) {
            void api
              .getApi<{
                results: { id: string; title: string; similarity: number }[];
              }>(`/products/search?q=${encodeURIComponent(product.title)}&limit=5&threshold=0.7`)
              .then((data) => setSimilarProducts(data.results));
          }
        });
      },
      { rootMargin: '200px' }
    );

    [variantsRef.current, matchesRef.current, historyRef.current, aiRef.current]
      .filter(Boolean)
      .forEach((el) => observer.observe(el as Element));

    return () => observer.disconnect();
  }, [api, product, variants.length, matches.length, events.length, similarProducts.length]);

  const groupedMetafields = useMemo(() => {
    const meta = product?.metafields ?? {};
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { default: meta };
    const groups: Record<string, Record<string, unknown>> = {};
    Object.entries(meta).forEach(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value) && 'namespace' in value) {
        const namespace = String((value as { namespace?: string }).namespace ?? 'default');
        const group = groups[namespace] ?? {};
        group[key] = value;
        groups[namespace] = group;
        return;
      }
      const ns = key.includes('.') ? (key.split('.')[0] ?? 'default') : 'default';
      const group = groups[ns] ?? {};
      group[key] = value;
      groups[ns] = group;
    });
    return groups;
  }, [product?.metafields]);

  if (loading || !product) {
    return <div className="text-sm text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader
        title={product.title}
        description={product.vendor ?? 'Product details'}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => undefined}>
              Force Sync
            </Button>
            <Button variant="secondary" onClick={() => undefined}>
              View in Shopify
            </Button>
            <Button variant="secondary" onClick={() => undefined}>
              Edit
            </Button>
          </div>
        }
      />

      <section className="rounded-lg border bg-background p-4">
        <div className="flex gap-4">
          <div className="h-24 w-24 overflow-hidden rounded-md border bg-muted/10">
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
          <div className="space-y-2">
            <div className="text-sm text-muted">Status: {product.status ?? '-'}</div>
            <div className="text-sm text-muted">Vendor: {product.vendor ?? '-'}</div>
            <div className="text-sm text-muted">Handle: {product.handle}</div>
            <div className="flex items-center gap-2">
              <QualityLevelBadge level={product.pim?.qualityLevel ?? null} />
              <span className="text-xs text-muted">Score: {product.pim?.qualityScore ?? '-'}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-background p-4" ref={variantsRef}>
        <div className="text-sm font-semibold">Variants</div>
        <div className="mt-3 overflow-hidden rounded-md border">
          <div className="grid grid-cols-5 gap-2 bg-muted/10 px-3 py-2 text-xs font-semibold">
            <span>SKU</span>
            <span>Price</span>
            <span>Stock</span>
            <span>Barcode</span>
            <span>Status</span>
          </div>
          {(variants.length ? variants : product.variants).map((variant) => (
            <div key={variant.id} className="grid grid-cols-5 gap-2 px-3 py-2 text-xs">
              <span>{variant.sku ?? '-'}</span>
              <span>{variant.price}</span>
              <span>{variant.inventoryQuantity}</span>
              <span>{variant.barcode ?? '-'}</span>
              <span>Active</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-background p-4">
        <div className="text-sm font-semibold">Metafields</div>
        <div className="mt-3 space-y-3">
          {Object.entries(groupedMetafields).map(([namespace, values]) => (
            <div key={namespace} className="rounded-md border p-2">
              <div className="text-xs font-semibold text-muted">{namespace}</div>
              <JsonViewer value={values} />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-background p-4" ref={matchesRef}>
        <div className="text-sm font-semibold">Enrichment Matches</div>
        <div className="mt-2 space-y-2 text-xs text-muted">
          {matches.length === 0
            ? 'No enrichment matches available.'
            : matches.map((match) => (
                <div key={match.id}>
                  {match.source_title ?? match.source_url} ({match.similarity_score})
                </div>
              ))}
        </div>
      </section>

      <section className="rounded-lg border bg-background p-4" ref={historyRef}>
        <div className="text-sm font-semibold">Sync History</div>
        <div className="mt-3">
          <Timeline
            events={events.map((event) => {
              const base = {
                id: event.id,
                timestamp: event.created_at,
                title: `${event.event_type} → ${event.new_level}`,
                status: event.event_type === 'quality_demoted' ? 'warning' : 'success',
              } as const;
              return event.quality_score_after
                ? { ...base, description: `Score: ${event.quality_score_after}` }
                : base;
            })}
            emptyState={<div className="text-xs text-muted">No sync events available.</div>}
          />
        </div>
      </section>

      <section className="rounded-lg border bg-background p-4" ref={aiRef}>
        <div className="text-sm font-semibold">AI Insights</div>
        <div className="mt-2 space-y-2 text-xs text-muted">
          {similarProducts.length === 0
            ? 'Embedding status unavailable for this product.'
            : similarProducts.map((item) => (
                <div key={item.id}>
                  {item.title} ({Math.round(item.similarity * 100)}%)
                </div>
              ))}
        </div>
      </section>
    </div>
  );
}
