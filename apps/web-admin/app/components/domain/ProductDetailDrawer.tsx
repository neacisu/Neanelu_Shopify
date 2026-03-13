import type { ProductDetail } from '@app/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, CheckCircle2, XCircle, Loader2, Clock, Circle } from 'lucide-react';
import { toast } from 'sonner';

import { useApiClient } from '../../hooks/use-api';
import { Button } from '../ui/button';
import { Drawer } from '../ui/drawer';
import { InfoTooltip } from '../ui/info-tooltip';
import { JsonViewer } from '../ui/JsonViewer';
import { ConflictIndicator } from './ConflictIndicator';
import { ConsensusStatusBadge } from './ConsensusStatusBadge';
import { QualityLevelBadge } from './QualityLevelBadge';
import { ShopifyAdminLink } from './ShopifyAdminLink';

interface SyncJobIds {
  consensusJobId: string | null;
  masterId: string | null;
}

type ProductDetailDrawerProps = Readonly<{
  open: boolean;
  product: ProductDetail | null;
  onClose: () => void;
  onForceSync: () => void | Promise<void | SyncJobIds | undefined>;
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

  // ── Sync progress types ────────────────────────────────────────────────────
  type StepStatus =
    | 'pending'
    | 'waiting'
    | 'active'
    | 'completed'
    | 'failed'
    | 'delayed'
    | 'not_found'
    | 'unknown'
    | 'skipped';
  interface SyncStep {
    id: string;
    label: string;
    status: StepStatus;
    failedReason?: string;
    progress: number | null; // 0-100 real BullMQ progress or null
    processedOn: number | null; // epoch ms when worker started
    finishedOn: number | null; // epoch ms when worker finished
    attemptsMade: number;
  }

  // Typical wall-clock duration per step (used for time-based progress estimation)
  const TYPICAL_MS: Record<string, number> = {
    shopify: 2000,
    pim_mapping: 500,
    consensus: 8000,
    category: 12000,
    description: 300000,
    metafield: 5000,
  };
  // Weight of each step in the overall progress bar (must sum to 100)
  const STEP_WEIGHT: Record<string, number> = {
    shopify: 10,
    pim_mapping: 5,
    consensus: 25,
    category: 20,
    description: 25,
    metafield: 15,
  };

  function estimatePct(step: SyncStep, nowMs: number, sessionStart: number): number {
    if (step.status === 'completed') return 100;
    if (step.status === 'failed') return 100;
    if (step.status === 'skipped') return 100;
    if (step.status === 'waiting' || step.status === 'delayed') return 0;
    if (step.status === 'pending' || step.status === 'not_found' || step.status === 'unknown')
      return 0;
    // active — use real progress if available, else time-based curve
    if (step.progress !== null && step.progress > 0) return Math.min(98, step.progress);
    // Only use processedOn if it belongs to the current session
    const validProcessedOn =
      step.processedOn != null && step.processedOn >= sessionStart ? step.processedOn : null;
    if (!validProcessedOn) return 5;
    const elapsed = nowMs - validProcessedOn;
    const typical = TYPICAL_MS[step.id] ?? 10000;
    return Math.min(92, Math.round(92 * (1 - Math.exp(-elapsed / typical))));
  }

  function calcOverall(steps: SyncStep[], nowMs: number, sessionStart: number): number {
    let totalW = 0,
      sum = 0;
    for (const s of steps) {
      const w = STEP_WEIGHT[s.id] ?? 10;
      totalW += w;
      sum += w * (estimatePct(s, nowMs, sessionStart) / 100);
    }
    return totalW > 0 ? Math.round((sum / totalW) * 100) : 0;
  }

  function fmtDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  // ── Sync state ─────────────────────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);
  const [syncSteps, setSyncSteps] = useState<SyncStep[] | null>(null);
  // nowMs ticks every second so progress bars and timers animate
  const [nowMs, setNowMs] = useState(() => Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollWarningShownRef = useRef(false);
  const lastObservedActivityRef = useRef(Date.now());
  const lastProgressSignatureRef = useRef<string | null>(null);
  const syncParamsRef = useRef<{
    productId: string;
    consensusJobId: string | null;
    masterId: string | null;
    syncStartMs: number;
    postEndMs: number;
  } | null>(null);

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const startTick = useCallback(() => {
    if (tickRef.current) return;
    tickRef.current = setInterval(() => setNowMs(Date.now()), 1000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Description generation can legitimately take multiple retries. Warn early,
  // but keep monitoring long enough to surface the final outcome correctly.
  const POLL_WARNING_MS = 3 * 60 * 1000;
  const POLL_STALE_TIMEOUT_MS = 10 * 60 * 1000;
  const POLL_ABSOLUTE_TIMEOUT_MS = 45 * 60 * 1000;

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    lastObservedActivityRef.current = Date.now();
    lastProgressSignatureRef.current = null;
    let consecutiveErrors = 0;
    const MAX_ERRORS = 4;
    pollRef.current = setInterval(() => {
      const p = syncParamsRef.current;
      if (!p?.masterId) return;

      const now = Date.now();
      const elapsedSinceSyncStart = now - p.syncStartMs;
      const stalledForMs = now - lastObservedActivityRef.current;

      if (!pollWarningShownRef.current && elapsedSinceSyncStart > POLL_WARNING_MS) {
        pollWarningShownRef.current = true;
        toast.warning(
          'Procesarea PIM durează mai mult decât de obicei, dar continuăm să monitorizăm retry-urile.'
        );
      }

      if (
        elapsedSinceSyncStart > POLL_ABSOLUTE_TIMEOUT_MS ||
        (elapsedSinceSyncStart > POLL_WARNING_MS && stalledForMs > POLL_STALE_TIMEOUT_MS)
      ) {
        stopPolling();
        stopTick();
        setSyncing(false);
        toast.error(
          'Procesarea PIM pare blocată fără activitate nouă — verifică logurile și starea joburilor.'
        );
        return;
      }

      const qs = new URLSearchParams({
        masterId: p.masterId,
        ...(p.consensusJobId ? { consensusJobId: p.consensusJobId } : {}),
        // Tell the backend the session start time so it can discard stale
        // completed jobs from previous runs that share the same job ID.
        sinceMs: String(p.syncStartMs),
      }).toString();
      void api
        .getApi<{ steps: SyncStep[]; allTerminal: boolean; anyFailed: boolean }>(
          `/products/${p.productId}/sync-status?${qs}`
        )
        .then((data) => {
          consecutiveErrors = 0;
          const allSteps: SyncStep[] = [
            {
              id: 'shopify',
              label: 'Preluare date din Shopify',
              status: 'completed',
              progress: 100,
              processedOn: p.syncStartMs,
              finishedOn: p.postEndMs,
              attemptsMade: 0,
            },
            {
              id: 'pim_mapping',
              label: 'Salvare locală & mapare PIM',
              status: 'completed',
              progress: 100,
              processedOn: p.syncStartMs,
              finishedOn: p.postEndMs,
              attemptsMade: 0,
            },
            ...data.steps,
          ];
          const progressSignature = allSteps
            .map(
              (step) =>
                `${step.id}:${step.status}:${step.progress ?? 'x'}:${step.attemptsMade}:${step.processedOn ?? 0}:${step.finishedOn ?? 0}`
            )
            .join('|');
          if (progressSignature !== lastProgressSignatureRef.current) {
            lastProgressSignatureRef.current = progressSignature;
            lastObservedActivityRef.current = Date.now();
          }
          setSyncSteps(allSteps);
          if (data.allTerminal) {
            stopPolling();
            stopTick();
            setSyncing(false);
            if (data.anyFailed) {
              toast.error('Unele job-uri PIM au eșuat — verifică logurile.');
            } else {
              toast.success('Sincronizare completă!', { duration: 4000 });
            }
          }
        })
        .catch(() => {
          consecutiveErrors += 1;
          if (consecutiveErrors >= MAX_ERRORS) {
            stopPolling();
            stopTick();
            setSyncing(false);
            toast.error('Pierdut contactul cu serverul — verifică dacă backend-ul rulează.');
          }
        });
    }, 1500);
  }, [api, stopPolling, stopTick]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
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
  const [metafieldLogs, setMetafieldLogs] = useState<
    {
      id: string;
      pushed_at: string;
      metafields_count: number | null;
      status: string;
      error_message: string | null;
    }[]
  >([]);

  interface ProductCollection {
    id: string;
    title: string;
    handle: string;
    collection_type: string;
    products_count: number;
  }
  const [productCollections, setProductCollections] = useState<ProductCollection[]>([]);

  interface MetafieldSchemaItem {
    attr_code: string;
    shopify_namespace: string;
    shopify_key: string;
    shopify_type: string;
    display_name: string | null;
    display_name_en: string | null;
    description: string | null;
    is_required: boolean;
    ai_generated: boolean;
    collection_title: string;
    current_value: unknown;
  }
  const [metafieldSchema, setMetafieldSchema] = useState<MetafieldSchemaItem[]>([]);
  const [schemaStats, setSchemaStats] = useState({ total: 0, filled: 0 });
  const [loadingSchema, setLoadingSchema] = useState(false);

  const loadMetafieldSchema = useCallback(
    async (productId: string) => {
      setLoadingSchema(true);
      try {
        const result = await api.getApi<{
          schema: MetafieldSchemaItem[];
          totalAttributes: number;
          filledAttributes: number;
        }>(`/products/${productId}/metafield-schema`);
        setMetafieldSchema(result.schema);
        setSchemaStats({ total: result.totalAttributes, filled: result.filledAttributes });
      } catch {
        setMetafieldSchema([]);
        setSchemaStats({ total: 0, filled: 0 });
      } finally {
        setLoadingSchema(false);
      }
    },
    [api]
  );

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

    if (product.pim?.masterId) {
      void api
        .getApi<{ logs: typeof metafieldLogs }>(`/pim/metafield-push/logs/${product.pim.masterId}`)
        .then((data) => setMetafieldLogs(data.logs))
        .catch(() => undefined);
    }

    void loadMetafieldSchema(product.id);

    void api
      .getApi<{ collections: ProductCollection[] }>(`/products/${product.id}/collections`)
      .then((data) => setProductCollections(data.collections))
      .catch(() => undefined);
  }, [api, open, product?.id, product?.pim?.masterId, loadMetafieldSchema]);

  // Reset syncing state when drawer closes
  useEffect(() => {
    if (!open) {
      stopPolling();
      stopTick();
      setSyncing(false);
      setSyncSteps(null);
      syncParamsRef.current = null;
      pollWarningShownRef.current = false;
      lastObservedActivityRef.current = Date.now();
      lastProgressSignatureRef.current = null;
    }
  }, [open, stopPolling, stopTick]);

  if (!open || !product) return null;

  const handleForceSync = async () => {
    if (syncing) return;
    const syncStartMs = Date.now();
    pollWarningShownRef.current = false;
    lastObservedActivityRef.current = syncStartMs;
    lastProgressSignatureRef.current = null;
    setSyncing(true);
    startTick();
    setSyncSteps([
      {
        id: 'shopify',
        label: 'Preluare date din Shopify',
        status: 'active',
        progress: null,
        processedOn: syncStartMs,
        finishedOn: null,
        attemptsMade: 0,
      },
      {
        id: 'pim_mapping',
        label: 'Salvare locală & mapare PIM',
        status: 'pending',
        progress: null,
        processedOn: null,
        finishedOn: null,
        attemptsMade: 0,
      },
      {
        id: 'consensus',
        label: 'Calcul calitate & consens',
        status: 'pending',
        progress: null,
        processedOn: null,
        finishedOn: null,
        attemptsMade: 0,
      },
      {
        id: 'category',
        label: 'Clasificare taxonomie',
        status: 'pending',
        progress: null,
        processedOn: null,
        finishedOn: null,
        attemptsMade: 0,
      },
      {
        id: 'description',
        label: 'Generare descriere produs',
        status: 'pending',
        progress: null,
        processedOn: null,
        finishedOn: null,
        attemptsMade: 0,
      },
      {
        id: 'metafield',
        label: 'Push metafields în Shopify',
        status: 'pending',
        progress: null,
        processedOn: null,
        finishedOn: null,
        attemptsMade: 0,
      },
    ]);
    try {
      const result = await Promise.resolve(onForceSync());
      const postEndMs = Date.now();
      const jobIds = result as SyncJobIds | undefined;
      syncParamsRef.current = {
        productId: product.id,
        consensusJobId: jobIds?.consensusJobId ?? null,
        masterId: jobIds?.masterId ?? null,
        syncStartMs,
        postEndMs,
      };
      setSyncSteps([
        {
          id: 'shopify',
          label: 'Preluare date din Shopify',
          status: 'completed',
          progress: 100,
          processedOn: syncStartMs,
          finishedOn: postEndMs,
          attemptsMade: 0,
        },
        {
          id: 'pim_mapping',
          label: 'Salvare locală & mapare PIM',
          status: 'completed',
          progress: 100,
          processedOn: syncStartMs,
          finishedOn: postEndMs,
          attemptsMade: 0,
        },
        {
          id: 'consensus',
          label: 'Calcul calitate & consens',
          status: 'waiting',
          progress: null,
          processedOn: null,
          finishedOn: null,
          attemptsMade: 0,
        },
        {
          id: 'category',
          label: 'Clasificare taxonomie',
          status: 'pending',
          progress: null,
          processedOn: null,
          finishedOn: null,
          attemptsMade: 0,
        },
        {
          id: 'description',
          label: 'Generare descriere produs',
          status: 'pending',
          progress: null,
          processedOn: null,
          finishedOn: null,
          attemptsMade: 0,
        },
        {
          id: 'metafield',
          label: 'Push metafields în Shopify',
          status: 'pending',
          progress: null,
          processedOn: null,
          finishedOn: null,
          attemptsMade: 0,
        },
      ]);
      if (jobIds?.masterId) {
        startPolling();
      } else {
        stopTick();
        setSyncing(false);
        setSyncSteps(null);
        toast.success('Date preluate din Shopify și salvate. Procesarea PIM rulează în fundal.', {
          duration: 6000,
        });
      }
    } catch (error) {
      stopPolling();
      stopTick();
      setSyncing(false);
      setSyncSteps(null);
      toast.error(error instanceof Error ? error.message : 'Force Sync a eșuat');
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={product.title}
      side="right"
      size="lg"
      showCloseButton
    >
      <div className="flex flex-1 flex-col">
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
                  Fără imagine
                </div>
              )}
            </div>
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-muted">Vânzător:</span> {product.vendor ?? '-'}
              </div>
              <div>
                <span className="text-muted">Status:</span> {product.status ?? '-'}
              </div>
              <div>
                <span className="text-muted">Handle:</span> {product.handle}
              </div>
            </div>
          </div>

          {/* Detalii complete produs din DB */}
          <div className="rounded-lg border border-border bg-card/50">
            <button
              type="button"
              className="flex w-full items-center justify-between p-3 text-sm font-medium text-foreground focus-ring-standard"
              onClick={() => toggleSection('productDetails')}
            >
              Detalii produs
              <ChevronRight
                className={`size-4 text-muted transition-transform duration-200${openSections['productDetails'] ? ' rotate-90' : ''}`}
              />
            </button>
            {openSections['productDetails'] && (
              <div className="border-t border-border p-3 space-y-1.5 text-xs">
                {(
                  [
                    ['ID intern', product.id],
                    ['Shopify GID', product.shopifyGid],
                    [
                      'Legacy Resource ID',
                      product.legacyResourceId ? String(product.legacyResourceId) : null,
                    ],
                    ['Tip produs', product.productType],
                    ['Template Suffix', product.templateSuffix],
                    ['Categorie Shopify (taxonomy)', product.categoryId],
                    ['Taxonomy PIM (AI/manual)', product.pim?.taxonomyId],
                    ['Taxonomy colecție (moștenită)', product.collectionTaxonomy?.taxonomyName],
                    ['Card cadou', product.isGiftCard ? 'Da' : 'Nu'],
                    ['Doar varianta default', product.hasOnlyDefaultVariant ? 'Da' : 'Nu'],
                    ['Are variante fără stoc', product.hasOutOfStockVariants ? 'Da' : 'Nu'],
                    ['Necesită plan vânzare', product.requiresSellingPlan ? 'Da' : 'Nu'],
                    ['Publicat la', product.publishedAt],
                    ['Creat Shopify', product.createdAtShopify],
                    ['Actualizat Shopify', product.updatedAtShopify],
                    ['Sincronizat la', product.syncedAt],
                    ['Creat în DB', product.createdAt],
                    ['Actualizat în DB', product.updatedAt],
                  ] as [string, string | boolean | null | undefined][]
                ).map(([label, value]) => (
                  <div key={label} className="flex gap-2">
                    <span className="w-40 shrink-0 text-muted">{label}:</span>
                    <span className="break-all text-foreground">
                      {value != null && value !== '' ? String(value) : '—'}
                    </span>
                  </div>
                ))}
                {product.tags.length > 0 && (
                  <div className="flex gap-2">
                    <span className="w-40 shrink-0 text-muted">Tags:</span>
                    <span className="break-all text-foreground">{product.tags.join(', ')}</span>
                  </div>
                )}
                {product.priceRange && (
                  <div className="flex gap-2">
                    <span className="w-40 shrink-0 text-muted">Interval preț:</span>
                    <span className="text-foreground">
                      {product.priceRange.min} – {product.priceRange.max}{' '}
                      {product.priceRange.currency}
                    </span>
                  </div>
                )}
                {product.compareAtPriceRange &&
                  Object.keys(product.compareAtPriceRange).length > 0 && (
                    <div className="flex gap-2">
                      <span className="w-40 shrink-0 text-muted">Interval preț comparat:</span>
                      <span className="text-foreground">
                        {JSON.stringify(product.compareAtPriceRange)}
                      </span>
                    </div>
                  )}
                {product.seo && Object.keys(product.seo).length > 0 && (
                  <div className="mt-1">
                    <div className="text-muted mb-0.5">SEO:</div>
                    <JsonViewer value={product.seo} />
                  </div>
                )}
                {product.options && product.options.length > 0 && (
                  <div className="mt-1">
                    <div className="text-muted mb-0.5">Opțiuni:</div>
                    <JsonViewer value={product.options} />
                  </div>
                )}
                {product.description && (
                  <div className="mt-1">
                    <div className="text-muted mb-0.5">Descriere (text):</div>
                    <div className="whitespace-pre-wrap text-foreground">{product.description}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-md border border-border bg-muted/5 p-3">
            <div className="text-xs font-semibold text-muted">Nivel calitate</div>
            <div className="mt-2 flex items-center gap-3">
              <QualityLevelBadge level={product.pim?.qualityLevel ?? null} />
              <div className="text-sm text-muted">Score: {product.pim?.qualityScore ?? '-'}</div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/5 p-3">
            <div className="text-xs font-semibold text-muted">Status consensus</div>
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

          {/* Colecții */}
          <div className="rounded-lg border border-border bg-card/50">
            <button
              type="button"
              className="flex w-full items-center justify-between p-3 text-sm font-medium text-foreground focus-ring-standard"
              onClick={() => toggleSection('collections')}
            >
              <span className="flex items-center gap-2">
                Colecții
                {productCollections.length > 0 && (
                  <span className="inline-flex items-center rounded-full bg-muted/20 px-1.5 py-0.5 text-xs font-medium text-muted">
                    {productCollections.length}
                  </span>
                )}
              </span>
              <ChevronRight
                className={`size-4 text-muted transition-transform duration-200${openSections['collections'] ? ' rotate-90' : ''}`}
              />
            </button>
            {openSections['collections'] && (
              <div className="border-t border-border p-3">
                {productCollections.length === 0 ? (
                  <div className="text-xs text-muted">Nu aparține niciunei colecții.</div>
                ) : (
                  <div className="space-y-1.5">
                    {productCollections.map((col) => (
                      <div
                        key={col.id}
                        className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{col.title}</span>
                          <span className="rounded bg-muted/15 px-1 py-0.5 text-[10px] uppercase text-muted">
                            {col.collection_type}
                          </span>
                        </div>
                        <span className="text-muted">{col.products_count} produse</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card/50">
            <button
              type="button"
              className="flex w-full items-center justify-between p-3 text-sm font-medium text-foreground focus-ring-standard"
              onClick={() => toggleSection('variants')}
            >
              Variante
              <ChevronRight
                className={`size-4 text-muted transition-transform duration-200${openSections['variants'] ? ' rotate-90' : ''}`}
              />
            </button>
            {openSections['variants'] && (
              <div className="border-t border-border p-3">
                <div className="space-y-2 text-xs text-muted">
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
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card/50">
            <button
              type="button"
              className="flex w-full items-center justify-between p-3 text-sm font-medium text-foreground focus-ring-standard"
              onClick={() => toggleSection('metafields')}
            >
              <span className="flex items-center gap-2">
                Metafields
                {schemaStats.total > 0 && (
                  <span
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
                      schemaStats.filled === schemaStats.total
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : schemaStats.filled > 0
                          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                    }`}
                  >
                    {schemaStats.filled}/{schemaStats.total}
                  </span>
                )}
              </span>
              <ChevronRight
                className={`size-4 text-muted transition-transform duration-200${openSections['metafields'] ? ' rotate-90' : ''}`}
              />
            </button>
            {openSections['metafields'] && (
              <div className="border-t border-border p-3 space-y-3">
                {loadingSchema ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-6 animate-pulse rounded bg-muted/20" />
                    ))}
                  </div>
                ) : metafieldSchema.length > 0 ? (
                  <>
                    <div className="text-xs text-muted mb-2">
                      Schema moștenită din colecție:{' '}
                      <strong>{metafieldSchema[0]?.collection_title}</strong>
                    </div>
                    <div className="overflow-hidden rounded-md border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/10">
                            <th className="px-2 py-1.5 text-left font-medium text-muted">
                              Atribut
                            </th>
                            <th className="px-2 py-1.5 text-left font-medium text-muted">Tip</th>
                            <th className="px-2 py-1.5 text-left font-medium text-muted">
                              Valoare
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {metafieldSchema.map((s) => (
                            <tr key={s.attr_code} className="hover:bg-muted/5">
                              <td className="px-2 py-1.5">
                                <div className="flex items-center gap-1">
                                  <span className="text-foreground font-medium">
                                    {s.display_name ?? s.attr_code}
                                  </span>
                                  {s.ai_generated && (
                                    <span className="text-purple-500" title="Generat cu AI">
                                      ✦
                                    </span>
                                  )}
                                  {s.is_required && (
                                    <span className="text-red-500 text-[10px]">*</span>
                                  )}
                                </div>
                                {s.description && (
                                  <div className="text-[10px] text-muted mt-0.5">
                                    {s.description}
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <span className="inline-block rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                  {s.shopify_type}
                                </span>
                              </td>
                              <td className="px-2 py-1.5">
                                {s.current_value != null ? (
                                  <span className="text-foreground">
                                    {JSON.stringify(s.current_value)}
                                  </span>
                                ) : (
                                  <span className="italic text-muted/60">— gol —</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-muted">
                    Nu există schemă de atribute definită pentru colecțiile acestui produs.
                  </div>
                )}

                {product.metafields && Object.keys(product.metafields).length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted hover:text-foreground">
                      Metafields brute Shopify
                    </summary>
                    <div className="mt-1">
                      <JsonViewer value={product.metafields} />
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card/50">
            <button
              type="button"
              className="flex w-full items-center justify-between p-3 text-sm font-medium text-foreground focus-ring-standard"
              onClick={() => toggleSection('syncHistory')}
            >
              Istoric sincronizare
              <ChevronRight
                className={`size-4 text-muted transition-transform duration-200${openSections['syncHistory'] ? ' rotate-90' : ''}`}
              />
            </button>
            {openSections['syncHistory'] && (
              <div className="border-t border-border p-3">
                <div className="space-y-2 text-xs text-muted">
                  {events.length === 0
                    ? 'Nu există istoric de sincronizare.'
                    : events.map((event) => (
                        <div key={event.id}>
                          {event.event_type} → {event.new_level} ({event.quality_score_after ?? '-'}
                          )
                        </div>
                      ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card/50">
            <button
              type="button"
              className="flex w-full items-center justify-between p-3 text-sm font-medium text-foreground focus-ring-standard"
              onClick={() => toggleSection('enrichmentSources')}
            >
              Surse îmbogățire
              <ChevronRight
                className={`size-4 text-muted transition-transform duration-200${openSections['enrichmentSources'] ? ' rotate-90' : ''}`}
              />
            </button>
            {openSections['enrichmentSources'] && (
              <div className="border-t border-border p-3">
                <div className="space-y-2 text-xs text-muted">
                  {matches.length === 0
                    ? 'Nu există încă surse de îmbogățire.'
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
                              Confirmă
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                void api
                                  .postApi(`/products/review/${match.id}/reject`, {})
                                  .then(() => {
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
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card/50">
            <button
              type="button"
              className="flex w-full items-center justify-between p-3 text-sm font-medium text-foreground focus-ring-standard"
              onClick={() => toggleSection('aiSuggestions')}
            >
              Sugestii AI
              <ChevronRight
                className={`size-4 text-muted transition-transform duration-200${openSections['aiSuggestions'] ? ' rotate-90' : ''}`}
              />
            </button>
            {openSections['aiSuggestions'] && (
              <div className="border-t border-border p-3">
                <div className="space-y-2 text-xs text-muted">
                  {similarProducts.length === 0
                    ? 'Nu există încă produse similare.'
                    : similarProducts.map((item) => (
                        <div key={item.id}>
                          {item.title} ({Math.round(item.similarity * 100)}%)
                        </div>
                      ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card/50">
            <button
              type="button"
              className="flex w-full items-center justify-between p-3 text-sm font-medium text-foreground focus-ring-standard"
              onClick={() => toggleSection('aiCategory')}
            >
              Categorie AI
              <ChevronRight
                className={`size-4 text-muted transition-transform duration-200${openSections['aiCategory'] ? ' rotate-90' : ''}`}
              />
            </button>
            {openSections['aiCategory'] && (
              <div className="border-t border-border p-3">
                <div className="space-y-2 text-xs text-muted">
                  {product.collectionTaxonomy ? (
                    <div className="rounded-md border border-blue-200 bg-blue-50 p-2 dark:border-blue-900 dark:bg-blue-950">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                        Moștenită din colecție
                      </div>
                      <div className="font-medium text-foreground">
                        {product.collectionTaxonomy.taxonomyName}
                      </div>
                      {product.collectionTaxonomy.taxonomyPath && (
                        <div className="mt-0.5 text-[10px] text-muted">
                          {product.collectionTaxonomy.taxonomyPath}
                        </div>
                      )}
                      <div className="mt-1 text-muted">
                        Colecție:{' '}
                        <span className="text-foreground">
                          {product.collectionTaxonomy.collectionTitle}
                        </span>
                      </div>
                      <div className="mt-0.5 text-muted">
                        Taxonomy ID:{' '}
                        <span className="font-mono text-[10px] text-foreground">
                          {product.collectionTaxonomy.taxonomyId}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  {product.pim ? (
                    <>
                      <div>
                        Status:{' '}
                        <span className="text-foreground">
                          {product.pim.taxonomyAiStatus ?? 'manual'}
                        </span>
                      </div>
                      <div>
                        Taxonomy ID produs:{' '}
                        <span className="font-mono text-[10px] text-foreground">
                          {product.pim.taxonomyId ?? '—'}
                        </span>
                      </div>
                      <div>
                        Confidence:{' '}
                        <span className="text-foreground">
                          {product.pim.taxonomyAiConfidence != null
                            ? `${Math.round(product.pim.taxonomyAiConfidence * 100)}%`
                            : '—'}
                        </span>
                      </div>
                      <div>
                        Metodă:{' '}
                        <span className="text-foreground">
                          {product.pim.taxonomyAiMethod ?? '—'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="italic text-muted/70">
                      Produsul nu are înregistrare PIM (rulează Force Sync).
                    </div>
                  )}
                  {!product.collectionTaxonomy && !product.pim?.taxonomyId && (
                    <div className="italic text-muted/70">Nicio taxonomie atribuită.</div>
                  )}
                  {product.pim?.masterId ? (
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void api.postApi(
                            `/pim/categories/assignments/${product.pim?.masterId}/approve`,
                            {}
                          )
                        }
                      >
                        Aprobă
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void api.postApi(
                            `/pim/categories/assignments/${product.pim?.masterId}/reject`,
                            {}
                          )
                        }
                      >
                        Respinge
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card/50">
            <button
              type="button"
              className="flex w-full items-center justify-between p-3 text-sm font-medium text-foreground focus-ring-standard"
              onClick={() => toggleSection('generatedDescription')}
            >
              Descriere generată
              <ChevronRight
                className={`size-4 text-muted transition-transform duration-200${openSections['generatedDescription'] ? ' rotate-90' : ''}`}
              />
            </button>
            {openSections['generatedDescription'] && (
              <div className="border-t border-border p-3">
                <div className="space-y-2 text-xs text-muted">
                  <div className="whitespace-pre-wrap text-sm text-foreground">
                    {product.pim?.descriptionMaster ?? 'Nu există descriere generată.'}
                  </div>
                  <div>
                    Generată la:{' '}
                    {(product.pim as { generatedAt?: string } | null)?.generatedAt ??
                      (product.pim as { descriptionGeneratedAt?: string } | null)
                        ?.descriptionGeneratedAt ??
                      '—'}
                  </div>
                  {product.pim?.masterId ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void api.postApi(
                          `/pim/description-generator/run/${product.pim?.masterId}`,
                          {}
                        )
                      }
                    >
                      Generează descriere
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card/50">
            <button
              type="button"
              className="flex w-full items-center justify-between p-3 text-sm font-medium text-foreground focus-ring-standard"
              onClick={() => toggleSection('syncedMetafields')}
            >
              Metafields sincronizate
              <ChevronRight
                className={`size-4 text-muted transition-transform duration-200${openSections['syncedMetafields'] ? ' rotate-90' : ''}`}
              />
            </button>
            {openSections['syncedMetafields'] && (
              <div className="border-t border-border p-3">
                <div className="space-y-2 text-xs text-muted">
                  {metafieldLogs.length === 0 ? (
                    <div>Nu există push log încă.</div>
                  ) : (
                    metafieldLogs.map((row) => (
                      <div key={row.id} className="rounded border border-border px-2 py-1">
                        {row.status} · {row.pushed_at} · {row.metafields_count ?? 0} metafields
                        {row.error_message ? ` · ${row.error_message}` : ''}
                      </div>
                    ))
                  )}
                  {product.pim?.masterId ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void api.postApi(`/pim/metafield-push/run/${product.pim?.masterId}`, {})
                      }
                    >
                      Forțează re-push metafields
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {syncSteps ? (
          <div className="border-t border-border bg-card/95 backdrop-blur-sm">
            {/* ── Overall header ─────────────────────────────────────────── */}
            {(() => {
              const sessionStart = syncParamsRef.current?.syncStartMs ?? 0;
              const overall = calcOverall(syncSteps, nowMs, sessionStart);
              const anyFailed = syncSteps.some((s) => s.status === 'failed');
              const allDone = overall === 100;
              // Anchor elapsed to the session start (when user clicked Force Sync).
              // Do NOT use Math.min(processedOn) from server steps — BullMQ keeps
              // old completed jobs in Redis (removeOnComplete: count:1000), so the
              // first few polls return stale processedOn timestamps from the *previous*
              // run, making the counter jump to e.g. "6m 36s" for a 2-second sync.
              const totalElapsed = (() => {
                const sessionStart = syncParamsRef.current?.syncStartMs;
                if (sessionStart == null) return 0;
                // Only count finishedOn values that belong to this session
                // (i.e. after the user clicked — anything before is a stale old job).
                const validEnds = syncSteps
                  .map((s) => s.finishedOn)
                  .filter((t): t is number => t !== null && t >= sessionStart);
                const allTerminalNow = syncSteps.every(
                  (s) => s.finishedOn != null && s.finishedOn >= sessionStart
                );
                const latest =
                  allTerminalNow && validEnds.length > 0 ? Math.max(...validEnds) : nowMs;
                return Math.max(0, latest - sessionStart);
              })();
              const activeStep = syncSteps.find((s) => s.status === 'active');
              const activeLabel = activeStep?.label ?? (allDone ? 'Complet' : 'Se procesează…');
              return (
                <div className="px-4 pt-3 pb-3 border-b border-border/50">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-start flex-col gap-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Procesare PIM
                      </span>
                      <span
                        className={`text-xs font-medium ${anyFailed ? 'text-destructive' : allDone ? 'text-green-600 dark:text-green-400' : 'text-primary'}`}
                      >
                        {anyFailed ? 'Eroare în pipeline' : activeLabel}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span
                        className={`text-xl font-bold font-mono leading-none ${anyFailed ? 'text-destructive' : allDone ? 'text-green-500' : 'text-foreground'}`}
                      >
                        {overall}%
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {fmtDuration(totalElapsed)} elapsed
                      </span>
                    </div>
                  </div>
                  {/* Master progress bar */}
                  <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ease-out${
                        anyFailed ? ' bg-destructive' : allDone ? ' bg-green-500' : ' bg-primary'
                      }`}
                      style={{ width: `${overall}%` }}
                    />
                    {/* shimmer overlay when in progress */}
                    {!allDone && !anyFailed && (
                      <div
                        className="absolute inset-0 rounded-full bg-linear-to-r from-transparent via-white/30 to-transparent animate-shimmer"
                        style={{ backgroundSize: '200% 100%' }}
                      />
                    )}
                  </div>
                </div>
              );
            })()}

            {/* ── Per-step rows ─────────────────────────────────────────── */}
            <div className="divide-y divide-border/40">
              {syncSteps.map((step) => {
                const sessionStart = syncParamsRef.current?.syncStartMs ?? 0;
                const pct = estimatePct(step, nowMs, sessionStart);
                const isActive = step.status === 'active';
                const isCompleted = step.status === 'completed';
                const isFailed = step.status === 'failed';
                const isSkipped = step.status === 'skipped';
                const isWaiting = step.status === 'waiting' || step.status === 'delayed';
                const isRetrying = isWaiting && (step.attemptsMade ?? 0) > 0;
                const isPending =
                  !isActive && !isCompleted && !isFailed && !isSkipped && !isWaiting;
                // Only use timestamps that belong to the current session.
                // BullMQ reuses job IDs; old completed jobs carry processedOn/finishedOn
                // from previous runs. Discard any timestamp that predates sessionStart.
                const validProcessedOn =
                  step.processedOn != null && step.processedOn >= sessionStart
                    ? step.processedOn
                    : null;
                const validFinishedOn =
                  step.finishedOn != null && step.finishedOn >= sessionStart
                    ? step.finishedOn
                    : null;

                let elapsed: number | null = null;
                if (validFinishedOn && validProcessedOn) {
                  elapsed = validFinishedOn - validProcessedOn;
                } else if (validProcessedOn && isActive) {
                  elapsed = nowMs - validProcessedOn;
                }

                return (
                  <div
                    key={step.id}
                    className={`px-4 py-2.5 transition-colors ${
                      isActive ? 'bg-primary/5' : isFailed ? 'bg-destructive/5' : ''
                    }`}
                  >
                    {/* Row 1: icon + label + right metadata */}
                    <div className="flex items-center gap-2">
                      {/* Step icon */}
                      <span className="w-5 shrink-0">
                        {isCompleted && <CheckCircle2 className="size-4 text-green-500" />}
                        {isFailed && <XCircle className="size-4 text-destructive" />}
                        {isSkipped && <CheckCircle2 className="size-4 text-muted-foreground" />}
                        {isActive && <Loader2 className="size-4 animate-spin text-primary" />}
                        {isWaiting && <Clock className="size-4 text-amber-400" />}
                        {isPending && <Circle className="size-4 text-border" />}
                      </span>

                      {/* Label */}
                      <span
                        className={`flex-1 text-sm leading-tight ${
                          isActive
                            ? 'font-semibold text-primary'
                            : isFailed
                              ? 'text-destructive'
                              : isSkipped
                                ? 'text-muted-foreground'
                                : isCompleted
                                  ? 'text-foreground'
                                  : 'text-muted-foreground'
                        }`}
                      >
                        {step.label}
                      </span>

                      {/* Right: badge + elapsed */}
                      <div className="flex shrink-0 items-center gap-2">
                        {(step.attemptsMade ?? 0) > 0 && (
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            R{step.attemptsMade}
                          </span>
                        )}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            isCompleted
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : isFailed
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                : isSkipped
                                  ? 'bg-muted text-muted-foreground'
                                  : isActive
                                    ? 'bg-primary/15 text-primary'
                                    : isWaiting
                                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                      : 'bg-muted/60 text-muted-foreground'
                          }`}
                        >
                          {isCompleted
                            ? 'DONE'
                            : isFailed
                              ? 'EȘUAT'
                              : isSkipped
                                ? 'SĂRIT'
                                : isActive
                                  ? (step.attemptsMade ?? 0) > 0
                                    ? 'RETRY'
                                    : 'ACTIV'
                                  : isWaiting
                                    ? isRetrying
                                      ? 'RETRY'
                                      : 'AȘTEPTARE'
                                    : 'PENDING'}
                        </span>
                        <span className="w-13 text-right font-mono text-[11px] text-muted-foreground">
                          {elapsed !== null ? fmtDuration(elapsed) : ''}
                        </span>
                      </div>
                    </div>

                    {/* Row 2: progress bar */}
                    <div className="mt-1.5 flex items-center gap-2 pl-7">
                      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        {isPending ? /* Pending: empty bar, no fill */
                        null : isWaiting ? (
                          /* Waiting: slow pulse to show it's queued */
                          <div className="absolute inset-0 rounded-full bg-amber-300/60 animate-pulse dark:bg-amber-600/40" />
                        ) : isSkipped ? (
                          <div
                            className="h-full rounded-full bg-muted-foreground/35"
                            style={{ width: '100%' }}
                          />
                        ) : isActive && pct < 5 ? (
                          /* Active but no progress yet: indeterminate sliding bar */
                          <div
                            className="absolute inset-0 -translate-x-full animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary/70"
                            style={{ width: '50%' }}
                          />
                        ) : (
                          /* Determinate fill */
                          <div
                            className={`h-full rounded-full transition-all duration-700 ease-out ${
                              isFailed
                                ? 'bg-destructive'
                                : isCompleted
                                  ? 'bg-green-500'
                                  : 'bg-primary'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        )}
                      </div>
                      <span className="w-8 shrink-0 text-right font-mono text-[11px] font-semibold text-muted-foreground">
                        {isActive || isCompleted || isFailed || isSkipped ? `${pct}%` : ''}
                      </span>
                    </div>

                    {/* Failed reason */}
                    {isFailed && step.failedReason ? (
                      <p className="mt-1 pl-7 text-[11px] leading-snug text-destructive/80 line-clamp-2">
                        {step.failedReason}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t border-border p-4">
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
    </Drawer>
  );
}
