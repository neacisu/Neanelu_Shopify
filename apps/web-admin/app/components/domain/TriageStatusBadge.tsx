import { Badge } from '../ui/badge.js';
import { InfoTooltip } from '../ui/info-tooltip.js';

type TriageStatus = 'auto_approve' | 'ai_audit' | 'hitl_required' | 'rejected';

const STATUS_TONES: Record<TriageStatus, 'success' | 'info' | 'warning' | 'critical'> = {
  auto_approve: 'success',
  ai_audit: 'info',
  hitl_required: 'warning',
  rejected: 'critical',
};

const LABELS: Record<TriageStatus, string> = {
  auto_approve: 'Auto',
  ai_audit: 'Revizuire AI',
  hitl_required: 'Revizuire umană',
  rejected: 'Respinse',
};

interface TriageStatusBadgeProps {
  status: TriageStatus;
}

export function TriageStatusBadge({ status }: TriageStatusBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={STATUS_TONES[status]}>{LABELS[status]}</Badge>
      <InfoTooltip title="Status triaj potrivire">
        Acest indicator arată cum a fost evaluată potrivirea în procesul de triaj automat. „Auto"
        înseamnă că potrivirea a fost aprobată automat — scorul de similaritate este suficient de
        ridicat (ex: peste 0.95). „Revizuire AI" înseamnă că sistemul de inteligență artificială
        analizează potrivirea — rezultatul va fi disponibil în curând. „Revizuire umană" înseamnă că
        e nevoie de decizia ta — scorul este în zona gri și nu poate fi determinat automat.
        „Respinse" înseamnă că potrivirea a fost respinsă — produsele nu sunt identice. Sfat:
        prioritizează potrivirile cu status „Revizuire umană" pentru a debloca procesul de
        îmbogățire.
      </InfoTooltip>
    </span>
  );
}
