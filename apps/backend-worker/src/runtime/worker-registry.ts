export type WorkerLike = Readonly<{
  isRunning?: () => boolean;
}>;

export type WorkerHandleLike = Readonly<{
  worker: WorkerLike;
}>;

let webhookWorker: WorkerLike | null = null;
let tokenHealthWorker: WorkerLike | null = null;

export function setWebhookWorkerHandle(handle: WorkerHandleLike | null): void {
  webhookWorker = handle?.worker ?? null;
}

export function setTokenHealthWorkerHandle(handle: WorkerHandleLike | null): void {
  tokenHealthWorker = handle?.worker ?? null;
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
}> {
  return {
    webhookWorkerOk: isWorkerRunning(webhookWorker),
    tokenHealthWorkerOk: tokenHealthWorker ? isWorkerRunning(tokenHealthWorker) : null,
  };
}
