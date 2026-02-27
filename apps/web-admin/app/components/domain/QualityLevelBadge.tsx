import type { QualityLevel } from '@app/types';
import { InfoTooltip } from '../ui/info-tooltip';

const labelMap: Record<QualityLevel, string> = {
  bronze: 'Bronz',
  silver: 'Argint',
  golden: 'Aur',
  review_needed: 'Revizuire',
};

const styleMap: Record<QualityLevel, string> = {
  bronze: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300',
  silver: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  golden: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  review_needed: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};

type QualityLevelBadgeProps = Readonly<{
  level: QualityLevel | null | undefined;
  recentlyPromoted?: boolean;
}>;

export function QualityLevelBadge({ level, recentlyPromoted }: QualityLevelBadgeProps) {
  if (!level) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 transition-transform duration-150 hover:scale-105 dark:bg-slate-700/40 dark:text-slate-400">
          Necunoscut
        </span>
        <InfoTooltip title="Nivel calitate necunoscut">
          Nivelul de calitate nu a putut fi determinat. Verifică dacă produsul are suficiente date
          (titlu, preț, descriere) pentru a putea fi evaluat automat de sistem.
        </InfoTooltip>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-transform duration-150 hover:scale-105 ${styleMap[level]} ${
          recentlyPromoted ? 'motion-safe:animate-[quality-pulse_2s_ease-in-out_3]' : ''
        }`}
        style={recentlyPromoted ? { boxShadow: '0 0 8px currentColor' } : undefined}
      >
        {labelMap[level]}
      </span>
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
