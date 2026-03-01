import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '../ui/badge';
import { Button } from '@/app/components/ui/button';
import { InfoTooltip } from '@/app/components/ui/info-tooltip';
import { JsonViewer } from '@/app/components/ui/JsonViewer';
import { ShopifyAdminLink, type ShopifyResourceType } from './ShopifyAdminLink';

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

  const dialogRef = useRef<HTMLDialogElement | null>(null);
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

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    }

    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };

    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [onClose]);

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

  // Extract Shopify resource info from job payload for linking
  const shopifyResource = useMemo(() => {
    const data = job?.data;
    if (!data || typeof data !== 'object') return null;

    const dataObj = data as Record<string, unknown>;

    // Try to detect resource type and ID from common payload patterns
    if (dataObj['productId'] || dataObj['product_id']) {
      return {
        type: 'products' as ShopifyResourceType,
        id: String(dataObj['productId'] ?? dataObj['product_id']),
        label: 'Vezi produsul în Shopify',
      };
    }
    if (dataObj['orderId'] || dataObj['order_id']) {
      return {
        type: 'orders' as ShopifyResourceType,
        id: String(dataObj['orderId'] ?? dataObj['order_id']),
        label: 'Vezi comanda în Shopify',
      };
    }
    if (dataObj['customerId'] || dataObj['customer_id']) {
      return {
        type: 'customers' as ShopifyResourceType,
        id: String(dataObj['customerId'] ?? dataObj['customer_id']),
        label: 'Vezi clientul în Shopify',
      };
    }
    if (dataObj['collectionId'] || dataObj['collection_id']) {
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
    const steps = [
      { label: 'Creat', time: formatDateMaybe(job.timestamp), done: true },
      { label: 'Procesat', time: formatDateMaybe(job.processedOn), done: job.processedOn != null },
      { label: 'Finalizat', time: formatDateMaybe(job.finishedOn), done: job.finishedOn != null },
    ];
    return steps;
  }, [job]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm motion-safe:animate-[fadeIn_0.2s_ease-out]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-[min(680px,100vw)] flex-col border-l bg-white/80 backdrop-blur-sm shadow-2xl motion-safe:animate-[slideInRight_0.3s_ease-out] dark:border-slate-700 dark:bg-slate-900/80"
        role="dialog"
        aria-label="Detalii job"
      >
        <div className="flex items-start justify-between gap-4 border-b p-4 dark:border-slate-700">
          <div>
            <div className="text-h3 dark:text-slate-100">Detalii job</div>
            <div className="mt-1 text-caption text-muted font-mono dark:text-slate-400">
              {queueName} / {jobId ?? '—'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {job?.state ? <Badge tone="neutral">{job.state}</Badge> : null}
            {job?.data ? (
              <span className="inline-flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void copyPayload()}
                  disabled={loading}
                >
                  {copySuccess ? 'Copiat' : 'Copiază payload'}
                </Button>
                <InfoTooltip title="Copiază payload" side="bottom" maxWidth={320}>
                  Copiază datele job-ului (payload) în clipboard pentru debugging. Poți lipi în
                  editorul tău preferat sau trimite echipei pentru analiză.
                </InfoTooltip>
              </span>
            ) : null}
            <Button variant="secondary" onClick={onClose}>
              Închide
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="text-sm text-muted dark:text-slate-400">Se încarcă…</div>
          ) : null}
          {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}

          {job ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-caption text-muted dark:text-slate-400">Nume</div>
                  <div className="font-mono dark:text-slate-200">{job.name}</div>
                </div>
                <div>
                  <div className="text-caption text-muted dark:text-slate-400">Încercări</div>
                  <div className="font-mono dark:text-slate-200">
                    {job.attemptsMade}
                    {attemptsMax !== null ? ` / ${attemptsMax}` : ''}
                  </div>
                </div>
              </div>

              {shopifyResource ? (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
                  <div className="text-caption text-muted mb-1 dark:text-slate-400">
                    Resursă Shopify asociată
                  </div>
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
                <div className="inline-flex items-center gap-1.5 text-h4 dark:text-slate-100">
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
                          className={`size-3 rounded-full ${step.done ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                        />
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          {step.label}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                          {step.time}
                        </span>
                      </div>
                      {i < timelineSteps.length - 1 && (
                        <div
                          className={`h-0.5 w-8 ${step.done ? 'bg-green-400' : 'bg-slate-200 dark:bg-slate-700'}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <details open className="space-y-2">
                <summary className="cursor-pointer select-none text-h4 dark:text-slate-100">
                  Payload (date job)
                </summary>
                <JsonViewer
                  value={payload}
                  collapseThresholdChars={120_000}
                  maxStringifyChars={200_000}
                />
              </details>

              <details className="space-y-2">
                <summary className="cursor-pointer select-none text-h4 dark:text-slate-100">
                  Opțiuni
                </summary>
                <JsonViewer
                  value={opts}
                  collapseThresholdChars={120_000}
                  maxStringifyChars={200_000}
                />
              </details>

              <details className="space-y-2">
                <summary className="cursor-pointer select-none text-h4 dark:text-slate-100">
                  Rezultat
                </summary>
                <JsonViewer
                  value={result}
                  collapseThresholdChars={120_000}
                  maxStringifyChars={60_000}
                />
              </details>

              <details className="space-y-2">
                <summary className="cursor-pointer select-none text-h4 dark:text-slate-100">
                  Stack trace
                </summary>
                <JsonViewer
                  value={stack}
                  collapseThresholdChars={120_000}
                  maxStringifyChars={60_000}
                />
              </details>

              <section className="space-y-2">
                <div className="text-h4 dark:text-slate-100">Loguri</div>
                <div className="text-sm text-muted dark:text-slate-400">
                  Nu există loguri disponibile.
                </div>
              </section>
            </div>
          ) : null}
        </div>

        <div className="border-t p-4 dark:border-slate-700">
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Închide
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
