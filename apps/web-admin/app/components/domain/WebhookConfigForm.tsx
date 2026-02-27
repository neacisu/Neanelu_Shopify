import { useMemo, useState } from 'react';

import type { QualityEventType } from '@app/types';
import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';

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
    <div className="space-y-3 rounded-md border border-muted/20 bg-background p-4 dark:border-slate-700 dark:bg-slate-900/80">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium dark:text-slate-100">
          Configurare webhook calitate
        </span>
        <InfoTooltip title="Webhook calitate PIM" side="bottom" portalToBody>
          Configurezi endpoint-ul unde se trimit notificări automate când un produs este promovat
          sau retrogradat, când se solicită revizuire sau când se atinge un prag (ex. 100 Golden
          Records). Secretul HMAC permite verificarea autenticității cererilor pe serverul tău. De
          exemplu, poți conecta un webhook la un canal Slack. Sfat: testează webhook-ul înainte de
          activare.
        </InfoTooltip>
      </div>
      <div className="grid gap-3">
        <label className="space-y-1">
          <div className="text-xs text-muted dark:text-slate-400">URL endpoint</div>
          <input
            className="h-9 w-full rounded-md border border-muted/20 bg-background px-2 text-sm shadow-sm transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
            placeholder="https://example.com/hooks/quality"
            value={url}
            onChange={(e) => setUrl((e.target as HTMLInputElement).value)}
          />
        </label>
        <label className="inline-flex items-center gap-2 text-sm dark:text-slate-200">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
            className="rounded border-muted/40 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
          />
          Activat
        </label>
        <label className="inline-flex items-center gap-2 text-sm dark:text-slate-200">
          <input
            type="checkbox"
            checked={regenerateSecret}
            onChange={(e) => setRegenerateSecret((e.target as HTMLInputElement).checked)}
            className="rounded border-muted/40 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
          />
          Regenerare secret
        </label>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted dark:text-slate-400">Evenimente</span>
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
              <label
                key={evt}
                className="inline-flex items-center gap-2 text-sm dark:text-slate-200"
              >
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
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted dark:text-slate-400">
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
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm dark:border-amber-700/50 dark:bg-amber-900/20">
            <div className="font-medium dark:text-amber-300">Secret (afișat o singură dată)</div>
            <div className="break-all font-mono text-xs dark:text-amber-200">{secretPreview}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
