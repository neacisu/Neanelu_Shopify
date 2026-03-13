import { Badge } from '../ui/badge.js';
import { InfoTooltip } from '../ui/info-tooltip.js';

type WebhookDeliveryStatus = 'sent' | 'pending' | 'failed' | 'retrying';

const LABELS: Record<WebhookDeliveryStatus, string> = {
  sent: 'Trimis',
  pending: 'În așteptare',
  failed: 'Eșuat',
  retrying: 'Reîncercare',
};

const TONES: Record<WebhookDeliveryStatus, 'success' | 'warning' | 'critical' | 'info'> = {
  sent: 'success',
  pending: 'warning',
  failed: 'critical',
  retrying: 'info',
};

export function WebhookDeliveryStatusBadge(props: {
  status: WebhookDeliveryStatus;
  title?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={TONES[props.status]}>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-current" aria-hidden />
          {LABELS[props.status]}
        </span>
      </Badge>
      <InfoTooltip title="Status livrare webhook">
        Acest indicator arată starea livrării webhook-ului către aplicația ta. „Trimis" înseamnă că
        webhook-ul a fost livrat cu succes — serverul a răspuns cu cod 2xx. „În așteptare" înseamnă
        că mesajul urmează să fie trimis — verifică că endpoint-ul tău este online. „Eșuat" înseamnă
        că livrarea a eșuat — serverul a returnat eroare, timeout sau este indisponibil.
        „Reîncercare" înseamnă că sistemul reîncearcă automat după un eșec anterior (maxim 3
        încercări). Sfat: dacă vezi multe eșecuri, verifică jurnalele serverului tău și asigură-te
        că endpoint-ul răspunde în sub 5 secunde.
      </InfoTooltip>
    </span>
  );
}
