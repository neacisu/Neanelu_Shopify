import { InfoTooltip } from '../ui/info-tooltip';

type Status = 'sent' | 'pending' | 'failed' | 'retrying';

const LABELS: Record<Status, string> = {
  sent: 'Trimis',
  pending: 'În așteptare',
  failed: 'Eșuat',
  retrying: 'Reîncercare',
};

const PALETTES: Record<Status, string> = {
  sent: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  pending:
    'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  failed:
    'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300',
  retrying:
    'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
};

export function WebhookDeliveryStatusBadge(props: { status: Status; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-transform duration-150 hover:scale-105 ${PALETTES[props.status]}`}
      >
        <span className="inline-block size-1.5 rounded-full bg-current" />
        {LABELS[props.status]}
      </span>
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
