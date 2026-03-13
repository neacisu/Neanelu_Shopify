import { Badge } from '../ui/badge.js';
import { InfoTooltip } from '../ui/info-tooltip.js';

type ConsensusStatus = 'pending' | 'computed' | 'conflicts' | 'manual_review';

const STATUS_LABELS: Record<ConsensusStatus, string> = {
  pending: 'În așteptare',
  computed: 'Calculat',
  conflicts: 'Conflicte',
  manual_review: 'Revizuire',
};

const STATUS_TONES: Record<ConsensusStatus, 'neutral' | 'success' | 'warning' | 'critical'> = {
  pending: 'neutral',
  computed: 'success',
  conflicts: 'warning',
  manual_review: 'critical',
};

export function ConsensusStatusBadge({ status }: { status: ConsensusStatus }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
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
