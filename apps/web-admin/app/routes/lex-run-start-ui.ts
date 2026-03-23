import type { LexRunType } from '@app/types';

/** Run types exposed in UI (plan F4-E3); `legacy_backfill` rămâne doar pentru job-uri interne/API. */
export const LEX_UI_START_RUN_TYPES = [
  'full_rebuild',
  'delta_rebuild',
  'context_rebuild',
  'translate_only',
  'publish_only',
] as const satisfies readonly LexRunType[];

export type LexUiStartRunType = (typeof LEX_UI_START_RUN_TYPES)[number];

export function lexRunTypeUiLabel(runType: LexRunType): string {
  switch (runType) {
    case 'full_rebuild':
      return 'Full rebuild — pipeline complet de la extracție';
    case 'delta_rebuild':
      return 'Delta rebuild — modificări incrementale';
    case 'context_rebuild':
      return 'Context rebuild — reconstruire contexte & embedding';
    case 'translate_only':
      return 'Translate only — doar faza de traducere';
    case 'publish_only':
      return 'Publish only — doar publicare ținte pending';
    case 'legacy_backfill':
      return 'Legacy backfill updated';
    default:
      return runType;
  }
}
