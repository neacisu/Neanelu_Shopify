import { useMemo, useState } from 'react';

import type { QualityEventType } from '@app/types';
import { Button } from '../ui/button';

const eventLabels: Record<QualityEventType, string> = {
  quality_promoted: 'Product promoted',
  quality_demoted: 'Product demoted',
  review_requested: 'Review requested',
  milestone_reached: 'Milestone reached',
};

const allEvents = Object.keys(eventLabels) as QualityEventType[];

type WebhookConfigSaveResult = Readonly<{ secretPlaintext?: string | null }> | null;

export function WebhookConfigForm(props: {
  initialConfig?: {
    url: string | null;
    enabled: boolean;
    subscribedEvents: QualityEventType[];
    secretMasked: string | null;
    secretPlaintext?: string;
  } | null;
  onSave: (payload: {
    url: string;
    enabled: boolean;
    subscribedEvents: QualityEventType[];
    regenerateSecret?: boolean;
  }) => Promise<WebhookConfigSaveResult>;
  isLoading?: boolean;
}) {
  const [url, setUrl] = useState(props.initialConfig?.url ?? '');
  const [enabled, setEnabled] = useState(Boolean(props.initialConfig?.enabled));
  const [selected, setSelected] = useState<QualityEventType[]>(
    props.initialConfig?.subscribedEvents?.length ? props.initialConfig.subscribedEvents : allEvents
  );
  const [regenerateSecret, setRegenerateSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secretPreview, setSecretPreview] = useState<string | null>(
    props.initialConfig?.secretPlaintext ?? null
  );

  const canSave = useMemo(
    () => selected.length > 0 && !saving && !props.isLoading,
    [selected, saving, props.isLoading]
  );

  return (
    <div className="space-y-3 rounded-md border border-muted/20 bg-background p-4">
      <div className="text-sm font-medium">Webhook configuration</div>
      <div className="grid gap-3">
        <label className="space-y-1">
          <div className="text-xs text-muted">Endpoint URL</div>
          <input
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            placeholder="https://example.com/hooks/quality"
            value={url}
            onChange={(e) => setUrl((e.target as HTMLInputElement).value)}
          />
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
          />
          Enabled
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={regenerateSecret}
            onChange={(e) => setRegenerateSecret((e.target as HTMLInputElement).checked)}
          />
          Regenerate secret
        </label>
        <div className="space-y-1">
          <div className="text-xs text-muted">Events</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {allEvents.map((evt) => (
              <label key={evt} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(evt)}
                  onChange={(e) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    setSelected((prev) =>
                      checked ? [...new Set([...prev, evt])] : prev.filter((item) => item !== evt)
                    );
                  }}
                />
                {eventLabels[evt]}
              </label>
            ))}
          </div>
        </div>
        <div className="text-xs text-muted">
          Secret: {props.initialConfig?.secretMasked ?? 'not set'}
        </div>
        <Button
          disabled={!canSave}
          onClick={() => {
            setSaving(true);
            void props
              .onSave({
                url,
                enabled,
                subscribedEvents: selected,
                ...(regenerateSecret ? { regenerateSecret: true } : {}),
              })
              .then((res) => {
                const plain = res?.secretPlaintext ?? null;
                if (plain) setSecretPreview(plain);
              })
              .finally(() => setSaving(false));
          }}
        >
          {saving ? 'Saving...' : 'Save configuration'}
        </Button>
        {secretPreview ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
            <div className="font-medium">Secret (show once)</div>
            <div className="break-all font-mono text-xs">{secretPreview}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
