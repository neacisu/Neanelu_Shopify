import { useState } from 'react';

import type { QualityEventType } from '@app/types';
import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';
import { JsonViewer } from '../ui/JsonViewer';
import { Select, type SelectOption } from '../ui/select';

const eventLabelsRo: Record<QualityEventType, string> = {
  quality_promoted: 'Produs promovat',
  quality_demoted: 'Produs retrogradat',
  review_requested: 'Revizuire solicitată',
  milestone_reached: 'Prag atins',
};

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
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Test webhook</span>
        <InfoTooltip title="Test webhook calitate" side="bottom" portalToBody>
          Trimite un eveniment de test către endpoint-ul configurat pentru a verifica integrarea.
          Răspunsul arată status HTTP, timp de răspuns și payload-ul exact trimis. De exemplu, un
          test „Produs promovat" simulează notificarea completă cu date fictive. Sfat: verifică că
          serverul tău răspunde cu 2xx în sub 5 secunde.
        </InfoTooltip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-52">
          <Select
            label="Eveniment"
            options={events.map((evt): SelectOption => ({ value: evt, label: eventLabelsRo[evt] }))}
            value={eventType}
            onChange={(e) => setEventType(e.target.value as QualityEventType)}
          />
        </div>
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
          {loading ? 'Se trimite…' : 'Trimite test'}
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
            {result.ok ? 'Succes' : 'Eșuat'} · status {result.httpStatus ?? 'n/a'} ·{' '}
            {result.responseTime} ms
            {result.error ? ` · ${result.error}` : ''}
          </div>
          <JsonViewer title="Payload trimis" value={result.payload ?? {}} maxHeight={220} />
        </div>
      ) : null}
    </div>
  );
}
