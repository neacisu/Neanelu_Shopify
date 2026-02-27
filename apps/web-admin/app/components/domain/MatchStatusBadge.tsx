import { InfoTooltip } from '../ui/info-tooltip';

interface MatchStatusBadgeProps {
  status: 'pending' | 'confirmed' | 'rejected' | 'uncertain';
}

const STATUS_STYLES: Record<MatchStatusBadgeProps['status'], string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  confirmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  uncertain: 'bg-amber-200/40 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
};

const STATUS_LABELS: Record<MatchStatusBadgeProps['status'], string> = {
  pending: 'În așteptare',
  confirmed: 'Confirmat',
  rejected: 'Respins',
  uncertain: 'Incert',
};

export function MatchStatusBadge({ status }: MatchStatusBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-transform duration-150 hover:scale-105 ${STATUS_STYLES[status]}`}
      >
        {STATUS_LABELS[status]}
      </span>
      <InfoTooltip title="Status potrivire">
        Acest indicator arată statusul potrivirii dintre produsul tău și o sursă externă. „În
        așteptare" înseamnă că decizia nu a fost luată — potrivirea așteaptă revizuire automată sau
        manuală. „Confirmat" înseamnă că produsele sunt considerate identice — datele vor fi
        folosite pentru îmbogățire. „Respins" înseamnă că produsele nu sunt aceleași — potrivirea nu
        va fi folosită. „Incert" înseamnă un scor de similaritate în zona gri (ex: 0.6-0.8) —
        recomandăm verificare manuală. Sfat: verifică potrivirile incerte cu prioritate, deoarece
        pot conține date valoroase dacă sunt confirmate.
      </InfoTooltip>
    </span>
  );
}
