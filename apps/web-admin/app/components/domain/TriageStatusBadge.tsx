import { InfoTooltip } from '../ui/info-tooltip';

interface TriageStatusBadgeProps {
  status: 'auto_approve' | 'ai_audit' | 'hitl_required' | 'rejected';
}

const STATUS_STYLES: Record<TriageStatusBadgeProps['status'], string> = {
  auto_approve: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  ai_audit: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  hitl_required: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const LABELS: Record<TriageStatusBadgeProps['status'], string> = {
  auto_approve: 'Auto',
  ai_audit: 'Revizuire AI',
  hitl_required: 'Revizuire umană',
  rejected: 'Respinse',
};

export function TriageStatusBadge({ status }: TriageStatusBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-transform duration-150 hover:scale-105 ${STATUS_STYLES[status]}`}
      >
        {LABELS[status]}
      </span>
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
