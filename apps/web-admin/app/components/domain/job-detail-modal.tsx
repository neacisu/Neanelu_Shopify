import { useEffect, useMemo, useRef } from 'react';

import { PolarisBadge } from '../../../components/polaris/index.js';
import { Button } from '@/app/components/ui/button';
import { JsonViewer } from '@/app/components/ui/JsonViewer';

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
    return new Date(ts).toLocaleString();
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

  return (
    <dialog
      ref={dialogRef}
      className="w-[min(1100px,calc(100vw-2rem))] rounded-lg border bg-background p-0 text-foreground shadow-xl"
      onClose={onClose}
    >
      <div className="flex items-start justify-between gap-4 border-b p-4">
        <div>
          <div className="text-h3">Job details</div>
          <div className="mt-1 text-caption text-muted font-mono">
            {queueName} / {jobId ?? '—'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {job?.state ? <PolarisBadge tone="neutral">{job.state}</PolarisBadge> : null}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <div className="max-h-[75vh] overflow-auto p-4">
        {loading ? <div className="text-sm text-muted">Loading…</div> : null}
        {error ? <div className="text-sm text-red-600">{error}</div> : null}

        {job ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-caption text-muted">Name</div>
                <div className="font-mono">{job.name}</div>
              </div>
              <div>
                <div className="text-caption text-muted">Attempts</div>
                <div className="font-mono">
                  {job.attemptsMade}
                  {attemptsMax !== null ? ` / ${attemptsMax}` : ''}
                </div>
              </div>
            </div>

            <section className="space-y-2">
              <div className="text-h4">Timeline</div>
              <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/10 p-3 text-sm md:grid-cols-2">
                <div>
                  <div className="text-caption text-muted">Created</div>
                  <div className="font-mono">{formatDateMaybe(job.timestamp)}</div>
                </div>
                <div>
                  <div className="text-caption text-muted">Processed</div>
                  <div className="font-mono">{formatDateMaybe(job.processedOn)}</div>
                </div>
                <div>
                  <div className="text-caption text-muted">Finished</div>
                  <div className="font-mono">{formatDateMaybe(job.finishedOn)}</div>
                </div>
                <div>
                  <div className="text-caption text-muted">State</div>
                  <div className="font-mono">{job.state ?? '—'}</div>
                </div>
              </div>
            </section>

            <details open className="space-y-2">
              <summary className="cursor-pointer select-none text-h4">Payload</summary>
              <JsonViewer
                value={payload}
                collapseThresholdChars={120_000}
                maxStringifyChars={200_000}
              />
            </details>

            <details className="space-y-2">
              <summary className="cursor-pointer select-none text-h4">Options</summary>
              <JsonViewer
                value={opts}
                collapseThresholdChars={120_000}
                maxStringifyChars={200_000}
              />
            </details>

            <details className="space-y-2">
              <summary className="cursor-pointer select-none text-h4">Result</summary>
              <JsonViewer
                value={result}
                collapseThresholdChars={120_000}
                maxStringifyChars={60_000}
              />
            </details>

            <details className="space-y-2">
              <summary className="cursor-pointer select-none text-h4">Stacktrace</summary>
              <JsonViewer
                value={stack}
                collapseThresholdChars={120_000}
                maxStringifyChars={60_000}
              />
            </details>

            <section className="space-y-2">
              <div className="text-h4">Logs</div>
              <div className="text-sm text-muted">No logs available.</div>
            </section>
          </div>
        ) : null}
      </div>

      <div className="border-t p-4">
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}
