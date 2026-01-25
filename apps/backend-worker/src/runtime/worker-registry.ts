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
let bulkOrchestratorWorker: WorkerLike | null = null;
let bulkPollerWorker: WorkerLike | null = null;
let bulkMutationReconcileWorker: WorkerLike | null = null;
let bulkIngestWorker: WorkerLike | null = null;
let aiBatchWorker: WorkerLike | null = null;

const currentJobByWorkerId = new Map<string, WorkerCurrentJob>();

export function setWebhookWorkerHandle(handle: WorkerHandleLike | null): void {
  webhookWorker = handle?.worker ?? null;
}

export function setTokenHealthWorkerHandle(handle: WorkerHandleLike | null): void {
  tokenHealthWorker = handle?.worker ?? null;
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
  bulkOrchestratorWorkerOk: boolean | null;
  bulkPollerWorkerOk: boolean | null;
  bulkMutationReconcileWorkerOk: boolean | null;
  bulkIngestWorkerOk: boolean | null;
  aiBatchWorkerOk: boolean | null;
}> {
  return {
    webhookWorkerOk: isWorkerRunning(webhookWorker),
    tokenHealthWorkerOk: tokenHealthWorker ? isWorkerRunning(tokenHealthWorker) : null,
    bulkOrchestratorWorkerOk: bulkOrchestratorWorker
      ? isWorkerRunning(bulkOrchestratorWorker)
      : null,
    bulkPollerWorkerOk: bulkPollerWorker ? isWorkerRunning(bulkPollerWorker) : null,
    bulkMutationReconcileWorkerOk: bulkMutationReconcileWorker
      ? isWorkerRunning(bulkMutationReconcileWorker)
      : null,
    bulkIngestWorkerOk: bulkIngestWorker ? isWorkerRunning(bulkIngestWorker) : null,
    aiBatchWorkerOk: aiBatchWorker ? isWorkerRunning(aiBatchWorker) : null,
  };
}
