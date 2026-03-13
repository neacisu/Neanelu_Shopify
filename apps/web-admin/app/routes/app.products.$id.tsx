import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Search } from 'lucide-react';

import type { ConsensusDetail, ProductDetail } from '@app/types';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Card } from '../components/ui/card';
import { Timeline } from '../components/ui/Timeline';
import { JsonViewer } from '../components/ui/JsonViewer';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { PromotionEligibilityCard } from '../components/domain/PromotionEligibilityCard';
import { ShopifyAdminLink } from '../components/domain/ShopifyAdminLink';
import { QualityLevelBadge } from '../components/domain/QualityLevelBadge';
import { ConsensusDetailDrawer } from '../components/domain/ConsensusDetailDrawer';
import { EmptyState } from '../components/patterns/empty-state.js';
import { ErrorState } from '../components/patterns/error-state.js';
import { LoadingState } from '../components/patterns/loading-state.js';
import { useApiClient } from '../hooks/use-api';
import { useQualityLevel } from '../hooks/use-quality-level';
import { reportUiError } from '../utils/report-ui-error';

export default function ProductDetailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const api = useApiClient();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [variants, setVariants] = useState<ProductDetail['variants']>([]);
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
  const [consensusOpen, setConsensusOpen] = useState(false);
  const [consensusLoading, setConsensusLoading] = useState(false);
  const [consensusDetail, setConsensusDetail] = useState<ConsensusDetail | null>(null);
  const [extractionSessions, setExtractionSessions] = useState<
    {
      id: string;
      harvestId: string;
      agentVersion: string;
      modelName: string | null;
      confidenceScore: string | null;
      tokensUsed: number | null;
      latencyMs: number | null;
      errorMessage: string | null;
      createdAt: string;
      sourceUrl: string;
      sourceType: string;
    }[]
  >([]);
  const [extractionsLoading, setExtractionsLoading] = useState(false);
  const [extractionsError, setExtractionsError] = useState<string | null>(null);
  const [promoteConfirm, setPromoteConfirm] = useState<{ level: string } | null>(null);
  const variantsRef = useRef<HTMLDivElement | null>(null);
  const matchesRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const aiRef = useRef<HTMLDivElement | null>(null);
  const extractionsRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [externalSearchLoading, setExternalSearchLoading] = useState(false);
  const qualityLevel = useQualityLevel(product?.id ?? null);
  const runQualityLevel = qualityLevel.run;
  const recentlyPromoted = useMemo(() => {
    const promotedAt =
      qualityLevel.data?.promotedToGoldenAt ?? qualityLevel.data?.promotedToSilverAt ?? null;
    if (!promotedAt) return false;
    const promotedTime = new Date(promotedAt).getTime();
    return Date.now() - promotedTime < 24 * 60 * 60 * 1000;
  }, [qualityLevel.data?.promotedToGoldenAt, qualityLevel.data?.promotedToSilverAt]);

  const breadcrumbs = useMemo(
    () => [
      { label: 'Acasă', href: '/' },
      { label: 'Produse', href: '/products' },
      { label: product?.title ?? 'Detalii', href: location.pathname },
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
    if (!product?.id) return;
    void runQualityLevel().catch(() => {
      toast.error('Nu pot incarca datele de promovare.');
    });
  }, [product?.id, runQualityLevel]);

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
          if (entry.target === extractionsRef.current && extractionSessions.length === 0) {
            const pimId = product.pim?.masterId;
            if (!pimId) return;
            setExtractionsLoading(true);
            setExtractionsError(null);
            void api
              .getApi<{ sessions: typeof extractionSessions }>(
                `/products/${pimId}/extraction-sessions`
              )
              .then((data) => setExtractionSessions(data.sessions))
              .catch((error) => {
                setExtractionsError(
                  error instanceof Error ? error.message : 'Nu pot incarca sesiunile de extractie.'
                );
              })
              .finally(() => setExtractionsLoading(false));
          }
        });
      },
      { rootMargin: '200px' }
    );

    [
      variantsRef.current,
      matchesRef.current,
      historyRef.current,
      aiRef.current,
      extractionsRef.current,
    ]
      .filter(Boolean)
      .forEach((el) => observer.observe(el as Element));

    return () => observer.disconnect();
  }, [
    api,
    product,
    variants.length,
    matches.length,
    events.length,
    similarProducts.length,
    extractionSessions.length,
  ]);

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

  const handleForceSync = async () => {
    if (!product) return;
    try {
      await api.postApi('/products/bulk-sync', { productIds: [product.id] });
      toast.success('Sincronizare fortata pusa in coada.');
    } catch (error) {
      reportUiError(error, { source: 'route', route: 'app.products.$id' });
      toast.error('Sincronizarea fortata a esuat.');
    }
  };

  const handleEdit = () => {
    if (!product) return;
    void navigate(`/products/${product.id}/edit`);
  };

  const handleManualPromote = (level: string) => {
    if (!product) return;
    setPromoteConfirm({ level });
  };

  const handleConfirmPromote = async () => {
    if (!product || !promoteConfirm) return;
    const { level } = promoteConfirm;
    setPromoteConfirm(null);
    try {
      await api.postApi(`/products/${product.id}/quality-level`, { level });
      toast.success(`Produs promovat la ${level}`);
      await runQualityLevel();
    } catch (error) {
      reportUiError(error, { source: 'route', route: 'app.products.$id' });
      toast.error('Promovarea manuala a esuat.');
    }
  };

  const handleExternalSearch = async () => {
    if (!product) return;
    setExternalSearchLoading(true);
    try {
      await api.postApi('/products/bulk-request-enrichment', { productIds: [product.id] });
      toast.success('Cautare externa pornita (enrichment in coada).');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nu pot porni cautarea externa.');
    } finally {
      setExternalSearchLoading(false);
    }
  };

  const handleOpenConsensus = async () => {
    if (!product?.pim?.masterId) {
      toast.error('Produsul nu are PIM masterId.');
      return;
    }
    const pimId = product.pim.masterId;
    setConsensusOpen(true);
    setConsensusLoading(true);
    try {
      const detail = await api.getApi<ConsensusDetail>(`/products/${pimId}/consensus/details`);
      setConsensusDetail(detail);
    } catch (error) {
      setConsensusDetail(null);
      toast.error(error instanceof Error ? error.message : 'Nu pot incarca detaliile consensus.');
    } finally {
      setConsensusLoading(false);
    }
  };

  if (loading || !product) {
    return <LoadingState label="Se încarcă produsul..." />;
  }

  return (
    <div className="space-y-6 transition-opacity duration-300">
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader
        title={product.title}
        description={product.vendor ?? 'Detalii produs'}
        actions={
          <div className="flex gap-2">
            <span className="inline-flex items-center gap-1">
              <InfoTooltip title="Căutare externă">
                Pornește căutarea automată de date suplimentare (GTIN, descrieri) din surse externe.
                Rezultatele vor apărea în secțiunea „Potriviri enrichment”.
              </InfoTooltip>
              <Button
                variant="secondary"
                onClick={() => void handleExternalSearch()}
                disabled={externalSearchLoading}
              >
                {externalSearchLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Caută extern
              </Button>
            </span>
            <span className="inline-flex items-center gap-1">
              <InfoTooltip title="Detalii consensus">
                Afișează cum s-au combinat datele din mai multe surse (enrichment) într-o singură
                valoare. Util pentru verificarea conflictelor și a surselor.
              </InfoTooltip>
              <Button
                variant="secondary"
                onClick={() => {
                  void handleOpenConsensus();
                }}
                disabled={consensusLoading}
              >
                {consensusLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Detalii consensus
              </Button>
            </span>
            <span className="inline-flex items-center gap-1">
              <InfoTooltip title="Forțare sincronizare">
                Trimite produsul în coada de sincronizare cu Shopify. Folosește când datele locale
                trebuie actualizate cu cele din magazin.
              </InfoTooltip>
              <Button
                variant="secondary"
                onClick={() => {
                  void handleForceSync();
                }}
              >
                Forțare sync
              </Button>
            </span>
            <ShopifyAdminLink
              resourceType="products"
              resourceId={product.id}
              title="Deschide produsul în panoul de administrare Shopify"
            >
              Vezi în Shopify
            </ShopifyAdminLink>
            <Button variant="secondary" onClick={handleEdit}>
              Editează
            </Button>
          </div>
        }
      />

      <Card padding="md">
        <div className="flex gap-4">
          <div className="h-24 w-24 overflow-hidden rounded-md border border-border bg-muted/10">
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
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted">Status:</span>
              <InfoTooltip title="Status produs">
                active = vizibil în magazin, draft = salvat dar nepublicat, archived = arhivat.
              </InfoTooltip>
              <span className="text-sm text-muted">{product.status ?? '-'}</span>
            </div>
            <div className="text-sm text-muted">Vânzător: {product.vendor ?? '-'}</div>
            <div className="text-sm text-muted">Handle: {product.handle}</div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <InfoTooltip title="Nivel calitate">
                  Bronze = date minime, Silver = date îmbogățite, Golden = date complete și
                  verificate.
                </InfoTooltip>
                <QualityLevelBadge
                  level={product.pim?.qualityLevel ?? null}
                  recentlyPromoted={recentlyPromoted}
                />
              </span>
              <span className="text-xs text-muted">Scor: {product.pim?.qualityScore ?? '-'}</span>
            </div>
          </div>
        </div>
      </Card>

      <Card padding="md">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold">Calitate și promovare</span>
          <InfoTooltip title="Promovare nivel">
            Produsele pot fi promovate la niveluri superioare când îndeplinesc cerințele (ex. număr
            surse, GTIN, descrieri). Promovarea deschide mai multe opțiuni de vânzare.
          </InfoTooltip>
        </div>
        <div className="mt-3">
          {qualityLevel.loading ? (
            <LoadingState label="Se incarcă datele de promovare..." />
          ) : qualityLevel.error ? (
            <ErrorState message="Nu pot incarca datele de promovare." />
          ) : qualityLevel.data ? (
            <PromotionEligibilityCard
              productId={product.id}
              currentLevel={qualityLevel.data.currentLevel}
              qualityScore={qualityLevel.data.qualityScore}
              sourceCount={qualityLevel.data.sourceCount}
              specsCount={qualityLevel.data.specsCount}
              eligibleForPromotion={qualityLevel.data.eligibleForPromotion}
              nextLevel={qualityLevel.data.nextLevel}
              nextThreshold={qualityLevel.data.nextThreshold}
              thresholds={qualityLevel.data.thresholds}
              missingRequirements={qualityLevel.data.missingRequirements}
              promotedToSilverAt={qualityLevel.data.promotedToSilverAt}
              promotedToGoldenAt={qualityLevel.data.promotedToGoldenAt}
              onPromote={(level) => {
                void handleManualPromote(level);
              }}
            />
          ) : (
            <div className="text-xs text-muted">Date de promovare indisponibile.</div>
          )}
        </div>
      </Card>

      <Card padding="md" ref={variantsRef}>
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold">Variante</span>
          <InfoTooltip title="Variante produs">
            Fiecare combinație de mărime, culoare etc. este o variantă. Prețul și stocul se
            gestionează per variantă.
          </InfoTooltip>
        </div>
        <div className="mt-3 overflow-hidden rounded-md border">
          <div className="grid grid-cols-5 gap-2 bg-muted/10 px-3 py-2 text-xs font-semibold">
            <span>SKU</span>
            <span>Pret</span>
            <span>Stoc</span>
            <span>Cod bare</span>
            <span>Status</span>
          </div>
          {(variants.length ? variants : product.variants).map((variant) => (
            <div
              key={variant.id}
              className="grid grid-cols-5 gap-2 px-3 py-2 text-xs border-t border-border"
            >
              <span>{variant.sku ?? '-'}</span>
              <span>{variant.price}</span>
              <span>{variant.inventoryQuantity}</span>
              <span>{variant.barcode ?? '-'}</span>
              <span>Activ</span>
            </div>
          ))}
        </div>
      </Card>

      <Card padding="md">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold">Metafields</span>
          <InfoTooltip title="Metafields">
            Câmpuri personalizate care extind informațiile produsului (ex. materiale, dimensiuni,
            certificări).
          </InfoTooltip>
        </div>
        <div className="mt-3 space-y-3">
          {Object.entries(groupedMetafields).map(([namespace, values]) => (
            <div key={namespace} className="rounded-md border border-border p-2">
              <div className="text-xs font-semibold text-muted">{namespace}</div>
              <JsonViewer value={values} />
            </div>
          ))}
        </div>
      </Card>

      <Card padding="md" ref={matchesRef}>
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold">Potriviri enrichment</span>
          <InfoTooltip title="Potriviri îmbogățire">
            Surse externe găsite automat care pot completa datele produsului. Poți confirma sau
            respinge fiecare potrivire.
          </InfoTooltip>
        </div>
        <div className="mt-3 space-y-2 text-xs text-muted">
          {matches.length === 0 ? (
            'Nu exista potriviri de enrichment.'
          ) : (
            <div className="space-y-2">
              {matches.map((match) => (
                <div key={match.id} className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm text-foreground">
                      {match.source_title ?? match.source_url}
                    </div>
                    <div className="text-xs text-muted">
                      Similaritate: {match.similarity_score} • {match.match_confidence}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void api.postApi(`/products/review/${match.id}/confirm`, {}).then(() => {
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
          )}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="mt-2 px-0"
            onClick={() => {
              const pimId = product?.pim?.masterId;
              if (!pimId) return;
              void navigate(`/similarity-matches?productId=${pimId}`);
            }}
          >
            Vezi toate potrivirile
          </Button>
        </div>
      </Card>

      <Card padding="md" ref={historyRef}>
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold">Istoric sincronizare</span>
          <InfoTooltip title="Istoric sincronizare">
            Evenimente de promovare sau retrogradare a nivelului de calitate, generate la
            sincronizare.
          </InfoTooltip>
        </div>
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
                ? { ...base, description: `Scor: ${event.quality_score_after}` }
                : base;
            })}
            emptyState={
              <div className="text-xs text-muted">Nu exista evenimente de sincronizare.</div>
            }
          />
        </div>
      </Card>

      <Card padding="md" ref={aiRef}>
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold">Sugestii AI</span>
          <InfoTooltip title="Produse similare (AI)">
            Produse din catalog găsite ca fiind similare semantic, pe baza descrierilor și
            titlurilor.
          </InfoTooltip>
        </div>
        <div className="mt-2 space-y-2 text-xs text-muted">
          {similarProducts.length === 0
            ? 'Status embedding indisponibil pentru acest produs.'
            : similarProducts.map((item) => (
                <div key={item.id}>
                  {item.title} ({Math.round(item.similarity * 100)}%)
                </div>
              ))}
        </div>
      </Card>

      <Card padding="md" ref={extractionsRef}>
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold">Sesiuni de extracție</span>
          <InfoTooltip title="Extracție date">
            Fiecare rulare a procesului de extragere automată a datelor din surse externe (pagini
            web, PDF-uri).
          </InfoTooltip>
        </div>
        <div className="mt-3">
          {extractionsLoading ? (
            <LoadingState label="Se incarca sesiunile de extractie..." />
          ) : null}
          {extractionsError ? <ErrorState message={extractionsError} /> : null}
          {!extractionsLoading && !extractionsError ? (
            extractionSessions.length === 0 ? (
              <EmptyState
                title="Nu există sesiuni"
                description="Nu există sesiuni de extracție pentru acest produs."
              />
            ) : (
              <div className="overflow-auto rounded-md border">
                <table className="min-w-[760px] w-full text-xs">
                  <thead className="bg-muted/20 text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">ID</th>
                      <th className="px-3 py-2 text-left font-medium">Model</th>
                      <th className="px-3 py-2 text-right font-medium">Incredere</th>
                      <th className="px-3 py-2 text-right font-medium">Tokens</th>
                      <th className="px-3 py-2 text-right font-medium">Latenta</th>
                      <th className="px-3 py-2 text-left font-medium">Sursa</th>
                      <th className="px-3 py-2 text-left font-medium">Creat</th>
                      <th className="px-3 py-2 text-left font-medium">Eroare</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extractionSessions.map((s) => (
                      <tr key={s.id} className="table-row-interactive border-t border-muted/20">
                        <td className="px-3 py-2 font-mono">{s.id.slice(0, 8)}…</td>
                        <td className="px-3 py-2">{s.modelName ?? s.agentVersion}</td>
                        <td className="px-3 py-2 text-right">{s.confidenceScore ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{s.tokensUsed ?? '—'}</td>
                        <td className="px-3 py-2 text-right">
                          {s.latencyMs != null ? `${s.latencyMs}ms` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <a
                            className="text-primary underline"
                            href={s.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {s.sourceType}
                          </a>
                        </td>
                        <td className="px-3 py-2">
                          {new Date(s.createdAt).toLocaleString('ro-RO')}
                        </td>
                        <td className="px-3 py-2">{s.errorMessage ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </div>
      </Card>

      {consensusOpen ? (
        consensusDetail ? (
          <ConsensusDetailDrawer
            isOpen={consensusOpen}
            onClose={() => setConsensusOpen(false)}
            onRecompute={() => {
              const pimId = product.pim?.masterId;
              if (!pimId) return;
              setConsensusLoading(true);
              void api
                .postApi(`/products/${pimId}/consensus`, {})
                .then(() => api.getApi<ConsensusDetail>(`/products/${pimId}/consensus/details`))
                .then((data) => setConsensusDetail(data))
                .catch((error) => {
                  toast.error(
                    error instanceof Error ? error.message : 'Recompute eșuat pentru consensus.'
                  );
                })
                .finally(() => setConsensusLoading(false));
            }}
            isRecomputing={consensusLoading}
            onExport={() => {
              const pimId = product.pim?.masterId;
              if (!pimId) return;
              void api.getJson<unknown>(`/products/${pimId}/consensus/export`).then((payload) => {
                const blob = new Blob([JSON.stringify(payload, null, 2)], {
                  type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `consensus-${pimId}.json`;
                link.click();
                URL.revokeObjectURL(url);
              });
            }}
            onViewProduct={() => void navigate(`/products/${product.id}`)}
            title={product.title}
            status={
              consensusDetail.conflictsCount > 0
                ? 'conflicts'
                : consensusDetail.results.length > 0
                  ? 'computed'
                  : 'pending'
            }
            qualityScore={consensusDetail.qualityScore ?? null}
            conflictsCount={consensusDetail.conflictsCount}
            breakdown={consensusDetail.qualityBreakdown}
            sources={consensusDetail.sources}
            results={consensusDetail.results}
            conflicts={consensusDetail.conflicts.map((conflict) => ({
              attributeName: conflict.attributeName,
              reason: conflict.reason,
              values: conflict.values,
            }))}
            provenance={consensusDetail.provenance}
            votesByAttribute={consensusDetail.votesByAttribute}
          />
        ) : consensusLoading ? (
          <Card padding="md">
            <LoadingState label="Se incarca detaliile consensus..." />
          </Card>
        ) : null
      ) : null}
      <ConfirmDialog
        open={promoteConfirm !== null}
        title="Confirmare promovare"
        description={promoteConfirm ? `Promovezi produsul la nivelul ${promoteConfirm.level}?` : ''}
        confirmLabel="Promovează"
        cancelLabel="Anulează"
        onConfirm={() => {
          void handleConfirmPromote();
        }}
        onClose={() => setPromoteConfirm(null)}
      />
    </div>
  );
}
