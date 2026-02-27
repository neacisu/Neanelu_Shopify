import { Loader2 } from 'lucide-react';

import { InfoTooltip } from '../ui/info-tooltip';

interface ExtractionStatusBadgeProps {
  status: 'pending' | 'in_progress' | 'complete' | 'failed';
}

const STATUS_STYLES: Record<ExtractionStatusBadgeProps['status'], string> = {
  pending: 'bg-slate-200/60 text-slate-600 dark:bg-slate-700/60 dark:text-slate-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  complete: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const STATUS_LABELS: Record<ExtractionStatusBadgeProps['status'], string> = {
  pending: 'În așteptare',
  in_progress: 'În curs',
  complete: 'Finalizat',
  failed: 'Eșuat',
};

export function ExtractionStatusBadge({ status }: ExtractionStatusBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-transform duration-150 hover:scale-105 ${STATUS_STYLES[status]}`}
      >
        {status === 'in_progress' ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
        {STATUS_LABELS[status]}
      </span>
      <InfoTooltip title="Status extracție date">
        Acest indicator arată progresul extracției datelor din sursa externă. „În așteptare"
        înseamnă că produsul este în coada de procesare și va fi preluat în curând. „În curs" (cu
        spinner) înseamnă că sistemul extrage activ informațiile — titlu, descriere, preț, imagini
        etc. „Finalizat" înseamnă că toate datele relevante au fost extrase cu succes și sunt
        disponibile pentru comparare. „Eșuat" înseamnă că extracția a dat eroare — pagina sursă
        poate fi indisponibilă sau formatul s-a schimbat. Sfat: pentru extracții eșuate, poți
        reîncerca mai târziu sau verifica manual URL-ul sursei.
      </InfoTooltip>
    </span>
  );
}
