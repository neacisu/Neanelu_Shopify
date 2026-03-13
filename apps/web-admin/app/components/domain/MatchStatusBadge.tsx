import { Badge } from '../ui/badge.js';
import { InfoTooltip } from '../ui/info-tooltip.js';

type MatchStatus = 'pending' | 'confirmed' | 'rejected' | 'uncertain';

const STATUS_TONES: Record<MatchStatus, 'warning' | 'success' | 'critical' | 'neutral'> = {
  pending: 'warning',
  confirmed: 'success',
  rejected: 'critical',
  uncertain: 'warning',
};

const STATUS_LABELS: Record<MatchStatus, string> = {
  pending: 'În așteptare',
  confirmed: 'Confirmat',
  rejected: 'Respins',
  uncertain: 'Incert',
};

interface MatchStatusBadgeProps {
  status: MatchStatus;
}

export function MatchStatusBadge({ status }: MatchStatusBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
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
