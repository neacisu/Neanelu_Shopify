import type { QualityLevel } from '@app/types';

import { Badge } from '../ui/badge.js';
import { InfoTooltip } from '../ui/info-tooltip.js';

const labelMap: Record<QualityLevel, string> = {
  bronze: 'Bronz',
  silver: 'Argint',
  golden: 'Aur',
  review_needed: 'Revizuire',
};

const toneMap: Record<QualityLevel, 'neutral' | 'info' | 'success' | 'warning'> = {
  bronze: 'neutral',
  silver: 'info',
  golden: 'success',
  review_needed: 'warning',
};

type QualityLevelBadgeProps = Readonly<{
  level: QualityLevel | null | undefined;
  recentlyPromoted?: boolean;
}>;

export function QualityLevelBadge({ level, recentlyPromoted }: QualityLevelBadgeProps) {
  if (!level) {
    return (
      <span className="inline-flex items-center gap-1">
        <Badge tone="neutral">Necunoscut</Badge>
        <InfoTooltip title="Nivel calitate necunoscut">
          Nivelul de calitate nu a putut fi determinat. Verifică dacă produsul are suficiente date
          (titlu, preț, descriere) pentru a putea fi evaluat automat de sistem.
        </InfoTooltip>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Badge
        tone={toneMap[level]}
        className={recentlyPromoted ? 'motion-safe:animate-[quality-pulse_2s_ease-in-out_3]' : ''}
        style={recentlyPromoted ? { boxShadow: '0 0 8px currentColor' } : undefined}
      >
        {labelMap[level]}
      </Badge>
      <InfoTooltip title="Nivel calitate produs">
        Acest indicator arată nivelul de calitate al datelor produsului. Bronze înseamnă că produsul
        are doar informațiile de bază (titlu și preț) — cam 30% din datele posibile. Silver înseamnă
        că are și descriere, imagini și categorie — aproximativ 60% din date. Golden înseamnă că are
        toate informațiile complete și verificate din cel puțin 2 surse independente — peste 90% din
        date. Review înseamnă că sistemul a găsit informații noi dar are nevoie de confirmarea ta
        înainte de a le aplica. Sfat: concentrează-te pe produsele Bronze și Silver pentru a le
        îmbunătăți calitatea.
      </InfoTooltip>
    </span>
  );
}
