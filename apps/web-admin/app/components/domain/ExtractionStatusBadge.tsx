import { Loader2 } from 'lucide-react';

import { Badge } from '../ui/badge.js';
import { InfoTooltip } from '../ui/info-tooltip.js';

type ExtractionStatus = 'pending' | 'in_progress' | 'complete' | 'failed';

const STATUS_LABELS: Record<ExtractionStatus, string> = {
  pending: 'În așteptare',
  in_progress: 'În curs',
  complete: 'Finalizat',
  failed: 'Eșuat',
};

const STATUS_TONES: Record<ExtractionStatus, 'neutral' | 'success' | 'critical' | 'info'> = {
  pending: 'neutral',
  in_progress: 'info',
  complete: 'success',
  failed: 'critical',
};

interface ExtractionStatusBadgeProps {
  status: ExtractionStatus;
}

export function ExtractionStatusBadge({ status }: ExtractionStatusBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={STATUS_TONES[status]}>
        <span className="inline-flex items-center gap-1.5">
          {status === 'in_progress' ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : null}
          {STATUS_LABELS[status]}
        </span>
      </Badge>
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
