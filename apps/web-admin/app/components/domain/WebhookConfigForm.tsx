import { useMemo, useState } from 'react';

import type { QualityEventType } from '@app/types';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { InfoTooltip } from '../ui/info-tooltip';
import { TextField } from '../ui/text-field';

const eventLabels: Record<QualityEventType, string> = {
  quality_promoted: 'Produs promovat',
  quality_demoted: 'Produs retrogradat',
  review_requested: 'Revizuire solicitată',
  milestone_reached: 'Prag atins',
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
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Configurare webhook calitate</span>
        <InfoTooltip title="Webhook calitate PIM" side="bottom" portalToBody>
          Configurezi endpoint-ul unde se trimit notificări automate când un produs este promovat
          sau retrogradat, când se solicită revizuire sau când se atinge un prag (ex. 100 Golden
          Records). Secretul HMAC permite verificarea autenticității cererilor pe serverul tău. De
          exemplu, poți conecta un webhook la un canal Slack. Sfat: testează webhook-ul înainte de
          activare.
        </InfoTooltip>
      </div>
      <div className="grid gap-3">
        <TextField
          label="URL endpoint"
          placeholder="https://example.com/hooks/quality"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <label className="inline-flex items-center gap-2 text-sm">
          <Checkbox
            checked={enabled}
            onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
          />
          Activat
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <Checkbox
            checked={regenerateSecret}
            onChange={(e) => setRegenerateSecret((e.target as HTMLInputElement).checked)}
          />
          Regenerare secret
        </label>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted">Evenimente</span>
            <InfoTooltip title="Tipuri evenimente webhook" side="bottom" portalToBody>
              Selectează ce tipuri de evenimente să fie trimise către endpoint-ul tău. „Produs
              promovat" se trimite când un produs trece la nivel superior de calitate. „Prag atins"
              se trimite la milestone-uri configurate (ex. 100 Golden Records). De exemplu, poți
              asculta doar promovări pentru rapoarte. Sfat: selectează toate pentru o vedere
              completă.
            </InfoTooltip>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {allEvents.map((evt) => (
              <label key={evt} className="inline-flex items-center gap-2 text-sm">
                <Checkbox
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
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted">
            Secret: {props.initialConfig?.secretMasked ?? 'neconfigurat'}
          </span>
          <InfoTooltip title="Secret HMAC webhook" side="bottom" portalToBody>
            Cheia folosită pentru semnarea HMAC-SHA256 a payload-ului webhook. Copiezi acest secret
            în aplicația ta pentru a verifica că notificările provin de la Neanelu. Se afișează o
            singură dată la creare sau regenerare. De exemplu, verifici header-ul
            X-Webhook-Signature pe serverul tău. Sfat: regenerează secretul dacă suspectezi o
            compromitere.
          </InfoTooltip>
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
          {saving ? 'Se salvează…' : 'Salvează configurația'}
        </Button>
        {secretPreview ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
            <div className="font-medium">Secret (afișat o singură dată)</div>
            <div className="break-all font-mono text-xs">{secretPreview}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
