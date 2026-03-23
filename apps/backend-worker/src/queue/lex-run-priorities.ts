/**
 * Priorități BullMQ pentru run-uri și batch-uri Lex (fără dependențe de cozi).
 * Modul separat pentru tipare stabile în workeri type-aware (ESLint / TS).
 */

const LEX_RUN_TYPE_PRIORITY: Record<string, number> = {
  delta_rebuild: 1,
  translate_only: 2,
  context_rebuild: 3,
  full_rebuild: 4,
  publish_only: 5,
};

export function lexRunTypePriority(runType: string | null | undefined): number {
  if (!runType) return 10;
  return LEX_RUN_TYPE_PRIORITY[runType] ?? 10;
}

/**
 * BullMQ group priority: lower number = processed sooner.
 * Within a run type, smaller source batches are scheduled before larger ones (f6-03).
 */
export function lexShardBatchPriority(params: {
  runPriority: number;
  batchRecordCount: number;
}): number {
  const tier = Math.min(4, Math.floor(Math.max(0, params.batchRecordCount - 1) / 2500));
  return params.runPriority + tier;
}
