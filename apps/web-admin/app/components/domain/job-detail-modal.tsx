import { useCallback, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { Badge } from '../ui/badge.js';
import { Button } from '@/app/components/ui/button';
import { Drawer } from '../ui/drawer';
import { InfoTooltip } from '@/app/components/ui/info-tooltip';
import { JsonViewer } from '@/app/components/ui/JsonViewer';
import { ShopifyAdminLink, type ShopifyResourceType } from './ShopifyAdminLink.js';

export type QueueJobDetail = Readonly<{
  id: string;
  name: string;
  state: string | null;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  attemptsMade: number;
  progress: unknown;
  failedReason: unknown;
  stacktrace: unknown;
  returnvalue: unknown;
  data: unknown;
  opts: unknown;
}>;

function formatDateMaybe(ts: number | null): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—';
  try {
    return new Date(ts).toLocaleString('ro-RO');
  } catch {
    return '—';
  }
}

export function JobDetailModal(props: {
  open: boolean;
  queueName: string;
  jobId: string | null;
  job: QueueJobDetail | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
}) {
  const { open, queueName, jobId, job, loading, error, onClose } = props;

  const [copySuccess, setCopySuccess] = useState(false);

  const copyPayload = useCallback(async () => {
    if (!job?.data) return;
    try {
      const str = typeof job.data === 'string' ? job.data : JSON.stringify(job.data, null, 2);
      await navigator.clipboard.writeText(str);
      setCopySuccess(true);
      window.setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // ignore
    }
  }, [job?.data]);

  const payload = useMemo(() => job?.data, [job?.data]);
  const opts = useMemo(() => job?.opts, [job?.opts]);
  const stack = useMemo(() => job?.stacktrace, [job?.stacktrace]);
  const result = useMemo(() => job?.returnvalue, [job?.returnvalue]);

  const attemptsMax = useMemo(() => {
    const raw = job?.opts;
    if (!raw || typeof raw !== 'object') return null;
    const v = (raw as Record<string, unknown>)['attempts'];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }, [job?.opts]);

  const shopifyResource = useMemo(() => {
    const data = job?.data;
    if (!data || typeof data !== 'object') return null;

    const dataObj = data as Record<string, unknown>;

    if (dataObj['productId'] ?? dataObj['product_id']) {
      return {
        type: 'products' as ShopifyResourceType,
        id: String(dataObj['productId'] ?? dataObj['product_id']),
        label: 'Vezi produsul în Shopify',
      };
    }
    if (dataObj['orderId'] ?? dataObj['order_id']) {
      return {
        type: 'orders' as ShopifyResourceType,
        id: String(dataObj['orderId'] ?? dataObj['order_id']),
        label: 'Vezi comanda în Shopify',
      };
    }
    if (dataObj['customerId'] ?? dataObj['customer_id']) {
      return {
        type: 'customers' as ShopifyResourceType,
        id: String(dataObj['customerId'] ?? dataObj['customer_id']),
        label: 'Vezi clientul în Shopify',
      };
    }
    if (dataObj['collectionId'] ?? dataObj['collection_id']) {
      return {
        type: 'collections' as ShopifyResourceType,
        id: String(dataObj['collectionId'] ?? dataObj['collection_id']),
        label: 'Vezi colecția în Shopify',
      };
    }

    return null;
  }, [job?.data]);

  const timelineSteps = useMemo(() => {
    if (!job) return [];
    return [
      { label: 'Creat', time: formatDateMaybe(job.timestamp), done: true },
      { label: 'Procesat', time: formatDateMaybe(job.processedOn), done: job.processedOn != null },
      { label: 'Finalizat', time: formatDateMaybe(job.finishedOn), done: job.finishedOn != null },
    ];
  }, [job]);

  if (!open) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Detalii job"
      side="right"
      size="lg"
      showCloseButton={false}
    >
      <div className="flex items-center gap-2 pb-4 border-b border-border/60">
        <div className="font-mono text-caption text-muted mr-auto">
          {queueName} / {jobId ?? '—'}
        </div>
        {job?.state ? <Badge tone="neutral">{job.state}</Badge> : null}
        {job?.data ? (
          <span className="inline-flex items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void copyPayload()}
              disabled={loading}
            >
              {copySuccess ? '✓ Copiat' : 'Copiază payload'}
            </Button>
            <InfoTooltip title="Copiază payload" side="bottom" maxWidth={320}>
              Copiază datele job-ului (payload) în clipboard pentru debugging. Poți lipi în editorul
              tău preferat sau trimite echipei pentru analiză.
            </InfoTooltip>
          </span>
        ) : null}
        <Button variant="secondary" onClick={onClose} className="ml-auto">
          Închide
        </Button>
      </div>

      <div className="mt-4 space-y-4">
        {loading ? (
          <div className="text-sm text-muted" aria-busy="true" aria-live="polite">
            Se încarcă…
          </div>
        ) : null}
        {error ? <div className="text-sm text-error">{error}</div> : null}

        {job ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-caption text-muted">Nume</div>
                <div className="font-mono text-foreground">{job.name}</div>
              </div>
              <div>
                <div className="text-caption text-muted">Încercări</div>
                <div className="font-mono text-foreground">
                  {job.attemptsMade}
                  {attemptsMax !== null ? ` / ${attemptsMax}` : ''}
                </div>
              </div>
            </div>

            {shopifyResource ? (
              <div className="rounded-md border border-info/20 bg-info/5 p-3">
                <div className="text-caption text-muted mb-1">Resursă Shopify asociată</div>
                <ShopifyAdminLink
                  resourceType={shopifyResource.type}
                  resourceId={shopifyResource.id}
                  className="text-sm font-medium"
                >
                  {shopifyResource.label} →
                </ShopifyAdminLink>
              </div>
            ) : null}

            <section className="space-y-2">
              <div className="inline-flex items-center gap-1.5 text-h4">
                Cronologie
                <InfoTooltip title="Cronologie job" side="bottom">
                  Pașii prin care trece un job: creare, procesare și finalizare. Fiecare pas arată
                  ora exactă. Un pas verde înseamnă că a fost atins cu succes.
                </InfoTooltip>
              </div>
              <div className="flex items-center gap-2 py-2">
                {timelineSteps.map((step, i) => (
                  <div key={step.label} className="flex items-center gap-2">
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className={`size-3 rounded-full transition-colors duration-normal ${step.done ? 'bg-success' : 'bg-muted/40'}`}
                      />
                      <span className="text-xs font-medium text-foreground">{step.label}</span>
                      <span className="font-mono text-[10px] text-muted">{step.time}</span>
                    </div>
                    {i < timelineSteps.length - 1 && (
                      <div
                        className={`h-0.5 w-8 transition-colors duration-normal ${step.done ? 'bg-success/60' : 'bg-border/60'}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>

            <details open className="group/details space-y-2">
              <summary className="interactive flex cursor-pointer select-none list-none items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-h4 hover:bg-subtle/40 [&::-webkit-details-marker]:hidden">
                <span>Payload (date job)</span>
                <ChevronDown
                  className="size-3.5 shrink-0 text-muted transition-transform duration-200 group-open/details:rotate-180"
                  aria-hidden
                />
              </summary>
              <JsonViewer
                value={payload}
                collapseThresholdChars={120_000}
                maxStringifyChars={200_000}
              />
            </details>

            <details className="group/details space-y-2">
              <summary className="interactive flex cursor-pointer select-none list-none items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-h4 hover:bg-subtle/40 [&::-webkit-details-marker]:hidden">
                <span>Opțiuni</span>
                <ChevronDown
                  className="size-3.5 shrink-0 text-muted transition-transform duration-200 group-open/details:rotate-180"
                  aria-hidden
                />
              </summary>
              <JsonViewer
                value={opts}
                collapseThresholdChars={120_000}
                maxStringifyChars={200_000}
              />
            </details>

            <details className="group/details space-y-2">
              <summary className="interactive flex cursor-pointer select-none list-none items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-h4 hover:bg-subtle/40 [&::-webkit-details-marker]:hidden">
                <span>Rezultat</span>
                <ChevronDown
                  className="size-3.5 shrink-0 text-muted transition-transform duration-200 group-open/details:rotate-180"
                  aria-hidden
                />
              </summary>
              <JsonViewer
                value={result}
                collapseThresholdChars={120_000}
                maxStringifyChars={60_000}
              />
            </details>

            <details className="group/details space-y-2">
              <summary className="interactive flex cursor-pointer select-none list-none items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-h4 hover:bg-subtle/40 [&::-webkit-details-marker]:hidden">
                <span>Stack trace</span>
                <ChevronDown
                  className="size-3.5 shrink-0 text-muted transition-transform duration-200 group-open/details:rotate-180"
                  aria-hidden
                />
              </summary>
              <JsonViewer
                value={stack}
                collapseThresholdChars={120_000}
                maxStringifyChars={60_000}
              />
            </details>

            <section className="space-y-2">
              <div className="text-h4 text-foreground">Loguri</div>
              <div className="text-sm text-muted">Nu există loguri disponibile.</div>
            </section>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
