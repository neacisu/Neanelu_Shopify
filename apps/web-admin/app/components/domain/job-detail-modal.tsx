import { useEffect, useMemo, useRef } from 'react';

import { PolarisBadge } from '../../../components/polaris/index.js';
import { Button } from '@/app/components/ui/button';

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

function safeJson(value: unknown, maxChars: number): { text: string; truncated: boolean } {
  try {
    const text = JSON.stringify(value, null, 2);
    if (text.length <= maxChars) return { text, truncated: false };
    return { text: `${text.slice(0, maxChars)}\n…(truncated)…`, truncated: true };
  } catch {
    return { text: String(value), truncated: false };
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function syntaxHighlightJson(text: string): { __html: string } {
  const escaped = escapeHtml(text);
  const highlighted = escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'text-foreground';
      if (match.startsWith('"')) {
        cls = match.endsWith(':')
          ? 'text-sky-700 dark:text-sky-300'
          : 'text-emerald-700 dark:text-emerald-300';
      } else if (match === 'true' || match === 'false') {
        cls = 'text-violet-700 dark:text-violet-300';
      } else if (match === 'null') {
        cls = 'text-muted';
      } else {
        cls = 'text-amber-700 dark:text-amber-300';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );

  return { __html: highlighted };
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

  const payload = useMemo(() => safeJson(job?.data, 200_000), [job?.data]);
  const opts = useMemo(() => safeJson(job?.opts, 200_000), [job?.opts]);
  const stack = useMemo(() => safeJson(job?.stacktrace, 60_000), [job?.stacktrace]);
  const result = useMemo(() => safeJson(job?.returnvalue, 60_000), [job?.returnvalue]);

  const MAX_HIGHLIGHT_CHARS = 200_000;
  const payloadHtml = useMemo(
    () => (payload.text.length <= MAX_HIGHLIGHT_CHARS ? syntaxHighlightJson(payload.text) : null),
    [payload.text]
  );
  const optsHtml = useMemo(
    () => (opts.text.length <= MAX_HIGHLIGHT_CHARS ? syntaxHighlightJson(opts.text) : null),
    [opts.text]
  );
  const resultHtml = useMemo(
    () => (result.text.length <= MAX_HIGHLIGHT_CHARS ? syntaxHighlightJson(result.text) : null),
    [result.text]
  );
  const stackHtml = useMemo(
    () => (stack.text.length <= MAX_HIGHLIGHT_CHARS ? syntaxHighlightJson(stack.text) : null),
    [stack.text]
  );

  const attemptsMax = useMemo(() => {
    const raw = job?.opts;
    if (!raw || typeof raw !== 'object') return null;
    const v = (raw as Record<string, unknown>)['attempts'];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }, [job?.opts]);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

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
              <div className="flex items-center justify-between gap-2">
                <div className="text-caption text-muted">
                  {payload.truncated ? 'truncated · ' : ''}
                  {payloadHtml ? 'syntax highlighted' : 'plain'}
                </div>
                <Button variant="ghost" onClick={() => void copyText(payload.text)}>
                  Copy
                </Button>
              </div>
              <pre className="overflow-auto rounded-md border bg-muted/10 p-3 text-xs">
                {payloadHtml ? <code dangerouslySetInnerHTML={payloadHtml} /> : payload.text}
              </pre>
            </details>

            <details className="space-y-2">
              <summary className="cursor-pointer select-none text-h4">Options</summary>
              <div className="flex items-center justify-between gap-2">
                <div className="text-caption text-muted">
                  {optsHtml ? 'syntax highlighted' : 'plain'}
                </div>
                <Button variant="ghost" onClick={() => void copyText(opts.text)}>
                  Copy
                </Button>
              </div>
              <pre className="overflow-auto rounded-md border bg-muted/10 p-3 text-xs">
                {optsHtml ? <code dangerouslySetInnerHTML={optsHtml} /> : opts.text}
              </pre>
            </details>

            <details className="space-y-2">
              <summary className="cursor-pointer select-none text-h4">Result</summary>
              <div className="flex items-center justify-between gap-2">
                <div className="text-caption text-muted">
                  {resultHtml ? 'syntax highlighted' : 'plain'}
                </div>
                <Button variant="ghost" onClick={() => void copyText(result.text)}>
                  Copy
                </Button>
              </div>
              <pre className="overflow-auto rounded-md border bg-muted/10 p-3 text-xs">
                {resultHtml ? <code dangerouslySetInnerHTML={resultHtml} /> : result.text}
              </pre>
            </details>

            <details className="space-y-2">
              <summary className="cursor-pointer select-none text-h4">Stacktrace</summary>
              <div className="flex items-center justify-between gap-2">
                <div className="text-caption text-muted">
                  {stackHtml ? 'syntax highlighted' : 'plain'}
                </div>
                <Button variant="ghost" onClick={() => void copyText(stack.text)}>
                  Copy
                </Button>
              </div>
              <pre className="overflow-auto rounded-md border bg-muted/10 p-3 text-xs">
                {stackHtml ? <code dangerouslySetInnerHTML={stackHtml} /> : stack.text}
              </pre>
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
