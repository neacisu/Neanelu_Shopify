export type WorkerLike = Readonly<{
  isRunning?: () => boolean;
}>;

export type WorkerHandleLike = Readonly<{
  worker: WorkerLike;
}>;

export type WorkerCurrentJob = Readonly<{
  jobId: string;
  jobName: string;
  startedAtIso: string;
  progressPct: number | null;
}>;

let webhookWorker: WorkerLike | null = null;
let tokenHealthWorker: WorkerLike | null = null;
let syncWorker: WorkerLike | null = null;
let bulkOrchestratorWorker: WorkerLike | null = null;
let bulkPollerWorker: WorkerLike | null = null;
let bulkMutationReconcileWorker: WorkerLike | null = null;
let bulkIngestWorker: WorkerLike | null = null;
let aiBatchWorker: WorkerLike | null = null;
let enrichmentWorker: WorkerLike | null = null;
let similaritySearchWorker: WorkerLike | null = null;
let similarityAIAuditWorker: WorkerLike | null = null;
let extractionWorker: WorkerLike | null = null;
let consensusWorker: WorkerLike | null = null;
let mvRefreshScheduler: WorkerLike | null = null;
let budgetResetScheduler: WorkerLike | null = null;
let weeklySummaryScheduler: WorkerLike | null = null;
let autoEnrichmentScheduler: WorkerLike | null = null;
let rawHarvestRetentionScheduler: WorkerLike | null = null;
let qualityWebhookWorker: WorkerLike | null = null;
let qualityWebhookSweepScheduler: WorkerLike | null = null;

const currentJobByWorkerId = new Map<string, WorkerCurrentJob>();

export function setWebhookWorkerHandle(handle: WorkerHandleLike | null): void {
  webhookWorker = handle?.worker ?? null;
}

export function setTokenHealthWorkerHandle(handle: WorkerHandleLike | null): void {
  tokenHealthWorker = handle?.worker ?? null;
}

export function setSyncWorkerHandle(handle: WorkerHandleLike | null): void {
  syncWorker = handle?.worker ?? null;
}

export function setBulkOrchestratorWorkerHandle(handle: WorkerHandleLike | null): void {
  bulkOrchestratorWorker = handle?.worker ?? null;
}

export function setBulkPollerWorkerHandle(handle: WorkerHandleLike | null): void {
  bulkPollerWorker = handle?.worker ?? null;
}

export function setBulkMutationReconcileWorkerHandle(handle: WorkerHandleLike | null): void {
  bulkMutationReconcileWorker = handle?.worker ?? null;
}

export function setBulkIngestWorkerHandle(handle: WorkerHandleLike | null): void {
  bulkIngestWorker = handle?.worker ?? null;
}

export function setAiBatchWorkerHandle(handle: WorkerHandleLike | null): void {
  aiBatchWorker = handle?.worker ?? null;
}

export function setEnrichmentWorkerHandle(handle: WorkerHandleLike | null): void {
  enrichmentWorker = handle?.worker ?? null;
}

export function setSimilaritySearchWorkerHandle(handle: WorkerHandleLike | null): void {
  similaritySearchWorker = handle?.worker ?? null;
}

export function setSimilarityAIAuditWorkerHandle(handle: WorkerHandleLike | null): void {
  similarityAIAuditWorker = handle?.worker ?? null;
}

export function setExtractionWorkerHandle(handle: WorkerHandleLike | null): void {
  extractionWorker = handle?.worker ?? null;
}

export function setConsensusWorkerHandle(handle: WorkerHandleLike | null): void {
  consensusWorker = handle?.worker ?? null;
}

export function setMvRefreshSchedulerHandle(handle: WorkerHandleLike | null): void {
  mvRefreshScheduler = handle?.worker ?? null;
}

export function setBudgetResetSchedulerHandle(handle: WorkerHandleLike | null): void {
  budgetResetScheduler = handle?.worker ?? null;
}

export function setWeeklySummarySchedulerHandle(handle: WorkerHandleLike | null): void {
  weeklySummaryScheduler = handle?.worker ?? null;
}

export function setAutoEnrichmentSchedulerHandle(handle: WorkerHandleLike | null): void {
  autoEnrichmentScheduler = handle?.worker ?? null;
}

export function setRawHarvestRetentionSchedulerHandle(handle: WorkerHandleLike | null): void {
  rawHarvestRetentionScheduler = handle?.worker ?? null;
}

export function setQualityWebhookWorkerHandle(handle: WorkerHandleLike | null): void {
  qualityWebhookWorker = handle?.worker ?? null;
}

export function setQualityWebhookSweepSchedulerHandle(handle: WorkerHandleLike | null): void {
  qualityWebhookSweepScheduler = handle?.worker ?? null;
}

export function setWorkerCurrentJob(workerId: string, job: WorkerCurrentJob): void {
  currentJobByWorkerId.set(workerId, job);
}

export function clearWorkerCurrentJob(workerId: string, jobId?: string): void {
  if (!jobId) {
    currentJobByWorkerId.delete(workerId);
    return;
  }

  const curr = currentJobByWorkerId.get(workerId);
  if (curr?.jobId === jobId) {
    currentJobByWorkerId.delete(workerId);
  }
}

export function getWorkerCurrentJob(workerId: string): WorkerCurrentJob | null {
  return currentJobByWorkerId.get(workerId) ?? null;
}

function isWorkerRunning(worker: WorkerLike | null): boolean {
  if (!worker) return false;
  const fn = worker.isRunning;
  if (typeof fn !== 'function') return false;
  try {
    return Boolean(fn.call(worker));
  } catch {
    return false;
  }
}

export function getWorkerReadiness(): Readonly<{
  webhookWorkerOk: boolean;
  tokenHealthWorkerOk: boolean | null;
  syncWorkerOk: boolean | null;
  bulkOrchestratorWorkerOk: boolean | null;
  bulkPollerWorkerOk: boolean | null;
  bulkMutationReconcileWorkerOk: boolean | null;
  bulkIngestWorkerOk: boolean | null;
  aiBatchWorkerOk: boolean | null;
  enrichmentWorkerOk: boolean | null;
  similaritySearchWorkerOk: boolean | null;
  similarityAIAuditWorkerOk: boolean | null;
  extractionWorkerOk: boolean | null;
  consensusWorkerOk: boolean | null;
  mvRefreshSchedulerOk: boolean | null;
  budgetResetSchedulerOk: boolean | null;
  weeklySummarySchedulerOk: boolean | null;
  autoEnrichmentSchedulerOk: boolean | null;
  rawHarvestRetentionSchedulerOk: boolean | null;
  qualityWebhookWorkerOk: boolean | null;
  qualityWebhookSweepSchedulerOk: boolean | null;
}> {
  return {
    webhookWorkerOk: isWorkerRunning(webhookWorker),
    tokenHealthWorkerOk: tokenHealthWorker ? isWorkerRunning(tokenHealthWorker) : null,
    syncWorkerOk: syncWorker ? isWorkerRunning(syncWorker) : null,
    bulkOrchestratorWorkerOk: bulkOrchestratorWorker
      ? isWorkerRunning(bulkOrchestratorWorker)
      : null,
    bulkPollerWorkerOk: bulkPollerWorker ? isWorkerRunning(bulkPollerWorker) : null,
    bulkMutationReconcileWorkerOk: bulkMutationReconcileWorker
      ? isWorkerRunning(bulkMutationReconcileWorker)
      : null,
    bulkIngestWorkerOk: bulkIngestWorker ? isWorkerRunning(bulkIngestWorker) : null,
    aiBatchWorkerOk: aiBatchWorker ? isWorkerRunning(aiBatchWorker) : null,
    enrichmentWorkerOk: enrichmentWorker ? isWorkerRunning(enrichmentWorker) : null,
    similaritySearchWorkerOk: similaritySearchWorker
      ? isWorkerRunning(similaritySearchWorker)
      : null,
    similarityAIAuditWorkerOk: similarityAIAuditWorker
      ? isWorkerRunning(similarityAIAuditWorker)
      : null,
    extractionWorkerOk: extractionWorker ? isWorkerRunning(extractionWorker) : null,
    consensusWorkerOk: consensusWorker ? isWorkerRunning(consensusWorker) : null,
    mvRefreshSchedulerOk: mvRefreshScheduler ? isWorkerRunning(mvRefreshScheduler) : null,
    budgetResetSchedulerOk: budgetResetScheduler ? isWorkerRunning(budgetResetScheduler) : null,
    weeklySummarySchedulerOk: weeklySummaryScheduler
      ? isWorkerRunning(weeklySummaryScheduler)
      : null,
    autoEnrichmentSchedulerOk: autoEnrichmentScheduler
      ? isWorkerRunning(autoEnrichmentScheduler)
      : null,
    rawHarvestRetentionSchedulerOk: rawHarvestRetentionScheduler
      ? isWorkerRunning(rawHarvestRetentionScheduler)
      : null,
    qualityWebhookWorkerOk: qualityWebhookWorker ? isWorkerRunning(qualityWebhookWorker) : null,
    qualityWebhookSweepSchedulerOk: qualityWebhookSweepScheduler
      ? isWorkerRunning(qualityWebhookSweepScheduler)
      : null,
  };
}
