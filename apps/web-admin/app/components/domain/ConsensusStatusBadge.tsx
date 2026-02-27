import { InfoTooltip } from '../ui/info-tooltip';

type ConsensusStatus = 'pending' | 'computed' | 'conflicts' | 'manual_review';

const STATUS_LABELS: Record<ConsensusStatus, string> = {
  pending: 'În așteptare',
  computed: 'Calculat',
  conflicts: 'Conflicte',
  manual_review: 'Revizuire',
};

const STATUS_STYLES: Record<ConsensusStatus, string> = {
  pending: 'bg-slate-200/60 text-slate-600 dark:bg-slate-700/60 dark:text-slate-400',
  computed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  conflicts: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  manual_review: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export function ConsensusStatusBadge({ status }: { status: ConsensusStatus }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-transform duration-150 hover:scale-105 ${STATUS_STYLES[status]}`}
      >
        {STATUS_LABELS[status]}
      </span>
      <InfoTooltip title="Status consens">
        Statusul de consens arată cum au fost reconciliate datele din diferite surse pentru acest
        produs. „În așteptare" înseamnă că sistemul procesează încă datele — rezultatul va fi
        disponibil în curând. „Calculat" înseamnă că valoarea finală a fost determinată automat cu
        succes, datele sunt consistente. „Conflicte" înseamnă că sursele au date diferite (ex:
        prețul diferă între Amazon și furnizor) — trebuie ales manual. „Revizuire" înseamnă că
        produsul a fost marcat pentru verificare manuală. Sfat: rezolvă întâi produsele cu status
        „Conflicte" pentru a putea finaliza sincronizarea.
      </InfoTooltip>
    </span>
  );
}
