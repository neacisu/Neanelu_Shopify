import { useState } from 'react';

import type { QualityEventType } from '@app/types';
import { Button } from '../ui/button';
import { JsonViewer } from '../ui/JsonViewer';

const events: QualityEventType[] = [
  'quality_promoted',
  'quality_demoted',
  'review_requested',
  'milestone_reached',
];

export function WebhookTestPanel(props: {
  webhookUrl?: string | null;
  onTest: (eventType: QualityEventType) => Promise<{
    ok: boolean;
    httpStatus: number | null;
    responseTime: number;
    error?: string;
    payload?: unknown;
  }>;
}) {
  const [eventType, setEventType] = useState<QualityEventType>('quality_promoted');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    httpStatus: number | null;
    responseTime: number;
    error?: string;
    payload?: unknown;
  } | null>(null);

  const disabled = !props.webhookUrl || loading;

  return (
    <div className="space-y-3 rounded-md border border-muted/20 bg-background p-4">
      <div className="text-sm font-medium">Test webhook</div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 min-w-52 rounded-md border bg-background px-2 text-sm"
          value={eventType}
          onChange={(e) => setEventType((e.target as HTMLSelectElement).value as QualityEventType)}
        >
          {events.map((evt) => (
            <option key={evt} value={evt}>
              {evt}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            setLoading(true);
            void props
              .onTest(eventType)
              .then(setResult)
              .finally(() => setLoading(false));
          }}
        >
          {loading ? 'Sending...' : 'Send test'}
        </Button>
      </div>
      {result ? (
        <div className="space-y-2">
          <div
            className={`rounded-md border p-2 text-sm ${
              result.ok
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-error/30 bg-error/10 text-error'
            }`}
            aria-live="polite"
          >
            {result.ok ? 'Success' : 'Failed'} · status {result.httpStatus ?? 'n/a'} ·{' '}
            {result.responseTime} ms
            {result.error ? ` · ${result.error}` : ''}
          </div>
          <JsonViewer title="Payload" value={result.payload ?? {}} maxHeight={220} />
        </div>
      ) : null}
    </div>
  );
}
