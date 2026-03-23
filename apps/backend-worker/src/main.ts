import { loadEnv } from '@app/config';
import { createLogger } from '@app/logger';
import {
  withTenantContext,
  closePool,
  startCredentialWatcher,
  stopCredentialWatcher,
  createManagedRedis,
  closeManagedRedisConnections,
  registerWorkerRecreator,
} from '@app/database';
import {
  getMaxBudgetRatios,
  registerBudgetGuardHooks,
  registerOtelCallback,
  closePimPool,
} from '@app/pim';
import { closeEnrichmentQueue, configFromEnv } from '@app/queue-manager';

import { buildServer } from './http/server.js';
import { startWebhookWorker } from './processors/webhooks/worker.js';
import { startTokenHealthWorker } from './processors/auth/token-health.worker.js';
import { startSyncWorker } from './processors/sync/worker.js';
import { startBulkOrchestratorWorker } from './processors/bulk-operations/orchestrator.worker.js';
import { startBulkPollerWorker } from './processors/bulk-operations/poller.worker.js';
import { startBulkMutationReconcileWorker } from './processors/bulk-operations/mutation-reconcile.worker.js';
import { startBulkIngestWorker } from './processors/bulk-operations/ingest.worker.js';
import { startBulkScheduleWorker } from './processors/bulk-operations/schedule.worker.js';
import { startPimManualSyncWorker } from './processors/pim/manual-sync.worker.js';
import { startAiBatchWorker } from './processors/ai/worker.js';
import { startAiBatchScheduleWorker } from './processors/ai/schedule.worker.js';
import { startOpenAiHealthWorker } from './processors/ai/health.worker.js';
import { startEnrichmentWorker } from './processors/enrichment/worker.js';
import { startSerperHealthWorker } from './processors/serper/health.worker.js';
import { startXaiHealthWorker } from './processors/xai/health.worker.js';
import { startSelfHostedHealthWorker } from './processors/selfhosted/health.worker.js';
import { startSimilaritySearchWorker } from './processors/similarity/search-and-match.worker.js';
import { startAIAuditWorker } from './processors/similarity/ai-audit.worker.js';
import { startExtractionWorker } from './processors/pim/extraction.worker.js';
import { startConsensusWorker } from './processors/pim/consensus.worker.js';
import { startCategoryClassifierWorker } from './processors/pim/category-classifier.worker.js';
import { startDescriptionGeneratorWorker } from './processors/pim/description-generator.worker.js';
import { startMetafieldPushWorker } from './processors/pim/metafield-push.worker.js';
import { startBudgetResetScheduler } from './processors/pim/budget-reset.worker.js';
import { startWeeklySummaryScheduler } from './processors/pim/weekly-summary.worker.js';
import { startMvRefreshScheduler } from './processors/pim/mv-refresh.worker.js';
import { startAutoEnrichmentScheduler } from './processors/pim/auto-enrichment.worker.js';
import { startRawHarvestRetentionScheduler } from './processors/pim/raw-harvest-retention.worker.js';
import { startQualityWebhookWorker } from './processors/pim/quality-webhook.worker.js';
import { startQualityWebhookSweepScheduler } from './processors/pim/quality-webhook-sweep.js';
import { startCollectionsSyncWorker } from './processors/pim/collections-sync.worker.js';
import { startCollectionMetafieldPushWorker } from './processors/pim/collection-metafield-push.worker.js';
import { startCollectionShopifySyncWorker } from './processors/pim/collection-shopify-sync.worker.js';
import { startLexExtractFragmentsWorker } from './processors/lex/extract-fragments.worker.js';
import { startLexExtractEntitiesWorker } from './processors/lex/extract-entities.worker.js';
import { startLexMineTermsWorker } from './processors/lex/mine-terms.worker.js';
import { startLexAggregateStatsWorker } from './processors/lex/aggregate-stats.worker.js';
import { startLexBuildContextsWorker } from './processors/lex/build-contexts.worker.js';
import { startLexEmbedContextsWorker } from './processors/lex/embed-contexts.worker.js';
import { startLexClusterSensesWorker } from './processors/lex/cluster-senses.worker.js';
import { startLexResolveAttributesWorker } from './processors/lex/resolve-attributes.worker.js';
import { startLexTranslateCandidatesWorker } from './processors/lex/translate-candidates.worker.js';
import { startLexComposeLocalizationsWorker } from './processors/lex/compose-localizations.worker.js';
import { startLexReviewEnqueueWorker } from './processors/lex/review-enqueue.worker.js';
import { startLexPublishWorker } from './processors/lex/publish.worker.js';
import { startLexScheduleWorker } from './processors/lex/schedule.worker.js';
import { startLexRetentionWorker } from './processors/lex/retention.worker.js';
import {
  listLexEnabledShops,
  reconcileLexScheduledTasks,
} from './processors/lex/scheduled-tasks.js';
import { pauseCostSensitiveQueues } from './processors/pim/cost-sensitive-queues.js';
import { scheduleTokenHealthJob, closeTokenHealthQueue } from './queue/token-health-queue.js';
import { closeSimilarityQueues } from './queue/similarity-queues.js';
import { closeQualityWebhookQueue } from './queue/quality-webhook-queue.js';
import { closeConsensusQueue } from './queue/consensus-queue.js';
import { closeCategoryClassifierQueue } from './queue/category-classifier-queue.js';
import { closeDescriptionGeneratorQueue } from './queue/description-generator-queue.js';
import { closeMetafieldPushQueue } from './queue/metafield-push-queue.js';
import { closePimManualSyncQueue } from './queue/pim-manual-sync-queue.js';
import { closeCollectionsSyncQueue } from './queue/collections-sync-queue.js';
import { closeCollectionMetafieldPushQueue } from './queue/collection-metafield-push-queue.js';
import { closeCollectionShopifySyncQueue } from './queue/collection-shopify-sync-queue.js';
import { closeLexQueues } from './queue/lex-queues.js';
import {
  setBulkOrchestratorWorkerHandle,
  setBulkIngestWorkerHandle,
  setPimManualSyncWorkerHandle,
  setBulkMutationReconcileWorkerHandle,
  setBulkPollerWorkerHandle,
  setAiBatchWorkerHandle,
  setAutoEnrichmentSchedulerHandle,
  setBudgetResetSchedulerHandle,
  setConsensusWorkerHandle,
  setEnrichmentWorkerHandle,
  setExtractionWorkerHandle,
  setMvRefreshSchedulerHandle,
  setQualityWebhookSweepSchedulerHandle,
  setQualityWebhookWorkerHandle,
  setSimilarityAIAuditWorkerHandle,
  setSimilaritySearchWorkerHandle,
  setSyncWorkerHandle,
  setTokenHealthWorkerHandle,
  setRawHarvestRetentionSchedulerHandle,
  setWeeklySummarySchedulerHandle,
  setWebhookWorkerHandle,
  setCollectionsSyncWorkerHandle,
  setCollectionMetafieldPushWorkerHandle,
  setCollectionShopifySyncWorkerHandle,
  setCategoryClassifierWorkerHandle,
  setDescriptionGeneratorWorkerHandle,
  setMetafieldPushWorkerHandle,
  setLexExtractEntitiesWorkerHandle,
  setLexExtractFragmentsWorkerHandle,
  setLexMineTermsWorkerHandle,
  setLexAggregateStatsWorkerHandle,
  setLexBuildContextsWorkerHandle,
  setLexEmbedContextsWorkerHandle,
  setLexClusterSensesWorkerHandle,
  setLexResolveAttributesWorkerHandle,
  setLexTranslateCandidatesWorkerHandle,
  setLexComposeLocalizationsWorkerHandle,
  setLexReviewEnqueueWorkerHandle,
  setLexPublishWorkerHandle,
  setLexScheduleWorkerHandle,
  setLexRetentionWorkerHandle,
} from './runtime/worker-registry.js';
import { emitQueueStreamEvent } from './runtime/queue-stream.js';
import { startQueueConfigListener } from './runtime/queue-config-listener.js';
import {
  recordPimApiUsage,
  recordPimBudgetExceeded,
  recordPimBudgetWarning,
  refreshPimBudgetUsageRatios,
} from './otel/metrics.js';

const env = loadEnv();
const logger = createLogger({
  service: 'backend-worker',
  env: env.nodeEnv,
  level: env.logLevel,
});

const server = await buildServer({
  env,
  logger,
});

const budgetNotificationOncePerDay = new Map<string, string>();
function budgetNotificationKey(params: {
  shopId: string;
  provider: string;
  kind: 'warning' | 'exceeded';
}) {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${params.shopId}:${params.provider}:${params.kind}:${day}`;
}

async function createBudgetNotification(params: {
  shopId: string;
  provider: string;
  kind: 'warning' | 'exceeded';
  primaryUsed: number;
  primaryLimit: number;
  primaryUnit: string;
  ratio: number;
  alertThreshold: number;
}): Promise<void> {
  const key = budgetNotificationKey({
    shopId: params.shopId,
    provider: params.provider,
    kind: params.kind,
  });
  if (budgetNotificationOncePerDay.get(key)) return;
  budgetNotificationOncePerDay.set(key, '1');

  const title =
    params.kind === 'exceeded'
      ? `Buget depasit: ${params.provider}`
      : `Buget aproape depasit: ${params.provider}`;
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `INSERT INTO pim_notifications (shop_id, type, title, body, read, created_at)
       VALUES ($1, $2, $3, $4::jsonb, false, now())`,
      [
        params.shopId,
        params.kind === 'exceeded' ? 'budget_exceeded' : 'budget_warning',
        title,
        JSON.stringify({
          provider: params.provider,
          kind: params.kind,
          primary: {
            used: params.primaryUsed,
            limit: params.primaryLimit,
            unit: params.primaryUnit,
            ratio: params.ratio,
          },
          alertThreshold: params.alertThreshold,
          timestamp: new Date().toISOString(),
        }),
      ]
    );
  });
}

registerBudgetGuardHooks({
  onWarning: (status) => {
    if (status.provider === 'serper' || status.provider === 'xai' || status.provider === 'openai') {
      recordPimBudgetWarning(status.provider);
    }
    void createBudgetNotification({
      shopId: status.shopId,
      provider: status.provider,
      kind: 'warning',
      primaryUsed: status.primary.used,
      primaryLimit: status.primary.limit,
      primaryUnit: status.primary.unit,
      ratio: status.primary.ratio,
      alertThreshold: status.alertThreshold,
    }).catch(() => undefined);
  },
  onExceeded: async (status) => {
    if (status.provider === 'serper' || status.provider === 'xai' || status.provider === 'openai') {
      recordPimBudgetExceeded(status.provider);
    }
    await createBudgetNotification({
      shopId: status.shopId,
      provider: status.provider,
      kind: 'exceeded',
      primaryUsed: status.primary.used,
      primaryLimit: status.primary.limit,
      primaryUnit: status.primary.unit,
      ratio: status.primary.ratio,
      alertThreshold: status.alertThreshold,
    }).catch(() => undefined);
    await pauseCostSensitiveQueues({
      config: configFromEnv(env),
      trigger: 'budget_enforcement',
      logger,
    });
  },
});

registerOtelCallback((params) => {
  recordPimApiUsage({
    provider: params.provider,
    operation: params.operation,
    estimatedCost: params.estimatedCost,
    requestCount: params.requestCount,
    tokensTotal: params.tokensTotal,
    responseTimeMs: params.responseTimeMs,
    isError: params.isError,
  });
});

let webhookWorker: Awaited<ReturnType<typeof startWebhookWorker>> | null = null;
let tokenHealthWorker: Awaited<ReturnType<typeof startTokenHealthWorker>> | null = null;
let syncWorker: Awaited<ReturnType<typeof startSyncWorker>> | null = null;
let bulkOrchestratorWorker: Awaited<ReturnType<typeof startBulkOrchestratorWorker>> | null = null;
let bulkPollerWorker: Awaited<ReturnType<typeof startBulkPollerWorker>> | null = null;
let bulkMutationReconcileWorker: Awaited<
  ReturnType<typeof startBulkMutationReconcileWorker>
> | null = null;
let bulkIngestWorker: Awaited<ReturnType<typeof startBulkIngestWorker>> | null = null;
let pimManualSyncWorker: Awaited<ReturnType<typeof startPimManualSyncWorker>> | null = null;
let bulkScheduleWorker: Awaited<ReturnType<typeof startBulkScheduleWorker>> | null = null;
let aiBatchWorker: Awaited<ReturnType<typeof startAiBatchWorker>> | null = null;
let aiBatchScheduleWorker: Awaited<ReturnType<typeof startAiBatchScheduleWorker>> | null = null;
let openAiHealthWorker: Awaited<ReturnType<typeof startOpenAiHealthWorker>> | null = null;
let enrichmentWorker: Awaited<ReturnType<typeof startEnrichmentWorker>> | null = null;
let serperHealthWorker: Awaited<ReturnType<typeof startSerperHealthWorker>> | null = null;
let xaiHealthWorker: Awaited<ReturnType<typeof startXaiHealthWorker>> | null = null;
let selfHostedHealthWorker: Awaited<ReturnType<typeof startSelfHostedHealthWorker>> | null = null;
let similaritySearchWorker: Awaited<ReturnType<typeof startSimilaritySearchWorker>> | null = null;
let similarityAIAuditWorker: Awaited<ReturnType<typeof startAIAuditWorker>> | null = null;
let extractionWorker: Awaited<ReturnType<typeof startExtractionWorker>> | null = null;
let consensusWorker: Awaited<ReturnType<typeof startConsensusWorker>> | null = null;
let categoryClassifierWorker: Awaited<ReturnType<typeof startCategoryClassifierWorker>> | null =
  null;
let descriptionGeneratorWorker: Awaited<ReturnType<typeof startDescriptionGeneratorWorker>> | null =
  null;
let metafieldPushWorker: Awaited<ReturnType<typeof startMetafieldPushWorker>> | null = null;
let budgetResetScheduler: Awaited<ReturnType<typeof startBudgetResetScheduler>> | null = null;
let weeklySummaryScheduler: Awaited<ReturnType<typeof startWeeklySummaryScheduler>> | null = null;
let mvRefreshScheduler: Awaited<ReturnType<typeof startMvRefreshScheduler>> | null = null;
let autoEnrichmentScheduler: Awaited<ReturnType<typeof startAutoEnrichmentScheduler>> | null = null;
let rawHarvestRetentionScheduler: Awaited<
  ReturnType<typeof startRawHarvestRetentionScheduler>
> | null = null;
let qualityWebhookWorker: Awaited<ReturnType<typeof startQualityWebhookWorker>> | null = null;
let qualityWebhookSweepScheduler: Awaited<
  ReturnType<typeof startQualityWebhookSweepScheduler>
> | null = null;
let collectionsSyncWorker: Awaited<ReturnType<typeof startCollectionsSyncWorker>> | null = null;
let collectionMetafieldPushWorker: Awaited<
  ReturnType<typeof startCollectionMetafieldPushWorker>
> | null = null;
let collectionShopifySyncWorker: Awaited<
  ReturnType<typeof startCollectionShopifySyncWorker>
> | null = null;
let lexExtractFragmentsWorker: Awaited<ReturnType<typeof startLexExtractFragmentsWorker>> | null =
  null;
let lexExtractEntitiesWorker: Awaited<ReturnType<typeof startLexExtractEntitiesWorker>> | null =
  null;
let lexMineTermsWorker: Awaited<ReturnType<typeof startLexMineTermsWorker>> | null = null;
let lexAggregateStatsWorker: Awaited<ReturnType<typeof startLexAggregateStatsWorker>> | null = null;
let lexBuildContextsWorker: Awaited<ReturnType<typeof startLexBuildContextsWorker>> | null = null;
let lexEmbedContextsWorker: Awaited<ReturnType<typeof startLexEmbedContextsWorker>> | null = null;
let lexClusterSensesWorker: Awaited<ReturnType<typeof startLexClusterSensesWorker>> | null = null;
let lexResolveAttributesWorker: Awaited<ReturnType<typeof startLexResolveAttributesWorker>> | null =
  null;
let lexTranslateCandidatesWorker: Awaited<
  ReturnType<typeof startLexTranslateCandidatesWorker>
> | null = null;
let lexComposeLocalizationsWorker: Awaited<
  ReturnType<typeof startLexComposeLocalizationsWorker>
> | null = null;
let lexReviewEnqueueWorker: Awaited<ReturnType<typeof startLexReviewEnqueueWorker>> | null = null;
let lexPublishWorker: Awaited<ReturnType<typeof startLexPublishWorker>> | null = null;
let lexScheduleWorker: Awaited<ReturnType<typeof startLexScheduleWorker>> | null = null;
let lexRetentionWorker: Awaited<ReturnType<typeof startLexRetentionWorker>> | null = null;
let queueConfigListener: Awaited<ReturnType<typeof startQueueConfigListener>> | null = null;
let budgetGaugeRedis: ReturnType<typeof createManagedRedis> | null = null;
let budgetGaugeInterval: NodeJS.Timeout | null = null;

interface ClosableHandle {
  close(): Promise<void>;
}

interface WorkerLifecycleEntry {
  readonly workerId: string;
  recreate(l: typeof logger): Promise<void>;
  teardown(): Promise<boolean>;
}

function workerEntry<T extends ClosableHandle>(
  workerId: string,
  get: () => T | null,
  set: (v: T | null) => void,
  startFn: (l: typeof logger) => T,
  setHandle?: (w: T | null) => void
): WorkerLifecycleEntry {
  return {
    workerId,
    async recreate(l) {
      const current = get();
      if (current) await current.close();
      const w = startFn(l);
      set(w);
      setHandle?.(w);
    },
    async teardown() {
      const w = get();
      if (!w) return false;
      await w.close();
      set(null);
      setHandle?.(null);
      return true;
    },
  };
}

const WORKER_ENTRIES: WorkerLifecycleEntry[] = [
  workerEntry(
    'webhook-worker',
    () => webhookWorker,
    (v) => {
      webhookWorker = v;
    },
    startWebhookWorker,
    setWebhookWorkerHandle
  ),
  workerEntry(
    'token-health-worker',
    () => tokenHealthWorker,
    (v) => {
      tokenHealthWorker = v;
    },
    startTokenHealthWorker,
    setTokenHealthWorkerHandle
  ),
  workerEntry(
    'sync-worker',
    () => syncWorker,
    (v) => {
      syncWorker = v;
    },
    startSyncWorker,
    setSyncWorkerHandle
  ),
  workerEntry(
    'bulk-orchestrator-worker',
    () => bulkOrchestratorWorker,
    (v) => {
      bulkOrchestratorWorker = v;
    },
    startBulkOrchestratorWorker,
    setBulkOrchestratorWorkerHandle
  ),
  workerEntry(
    'bulk-poller-worker',
    () => bulkPollerWorker,
    (v) => {
      bulkPollerWorker = v;
    },
    startBulkPollerWorker,
    setBulkPollerWorkerHandle
  ),
  workerEntry(
    'bulk-mutation-reconcile-worker',
    () => bulkMutationReconcileWorker,
    (v) => {
      bulkMutationReconcileWorker = v;
    },
    startBulkMutationReconcileWorker,
    setBulkMutationReconcileWorkerHandle
  ),
  workerEntry(
    'bulk-ingest-worker',
    () => bulkIngestWorker,
    (v) => {
      bulkIngestWorker = v;
    },
    startBulkIngestWorker,
    setBulkIngestWorkerHandle
  ),
  workerEntry(
    'pim-manual-sync-worker',
    () => pimManualSyncWorker,
    (v) => {
      pimManualSyncWorker = v;
    },
    startPimManualSyncWorker,
    setPimManualSyncWorkerHandle
  ),
  workerEntry(
    'bulk-schedule-worker',
    () => bulkScheduleWorker,
    (v) => {
      bulkScheduleWorker = v;
    },
    startBulkScheduleWorker
  ),
  workerEntry(
    'ai-batch-worker',
    () => aiBatchWorker,
    (v) => {
      aiBatchWorker = v;
    },
    startAiBatchWorker,
    setAiBatchWorkerHandle
  ),
  workerEntry(
    'ai-batch-schedule-worker',
    () => aiBatchScheduleWorker,
    (v) => {
      aiBatchScheduleWorker = v;
    },
    startAiBatchScheduleWorker
  ),
  workerEntry(
    'openai-health-worker',
    () => openAiHealthWorker,
    (v) => {
      openAiHealthWorker = v;
    },
    startOpenAiHealthWorker
  ),
  workerEntry(
    'serper-health-worker',
    () => serperHealthWorker,
    (v) => {
      serperHealthWorker = v;
    },
    startSerperHealthWorker
  ),
  workerEntry(
    'xai-health-worker',
    () => xaiHealthWorker,
    (v) => {
      xaiHealthWorker = v;
    },
    startXaiHealthWorker
  ),
  workerEntry(
    'selfhosted-health-worker',
    () => selfHostedHealthWorker,
    (v) => {
      selfHostedHealthWorker = v;
    },
    startSelfHostedHealthWorker
  ),
  workerEntry(
    'enrichment-worker',
    () => enrichmentWorker,
    (v) => {
      enrichmentWorker = v;
    },
    startEnrichmentWorker,
    setEnrichmentWorkerHandle
  ),
  workerEntry(
    'similarity-search-worker',
    () => similaritySearchWorker,
    (v) => {
      similaritySearchWorker = v;
    },
    startSimilaritySearchWorker,
    setSimilaritySearchWorkerHandle
  ),
  workerEntry(
    'ai-audit-worker',
    () => similarityAIAuditWorker,
    (v) => {
      similarityAIAuditWorker = v;
    },
    startAIAuditWorker,
    setSimilarityAIAuditWorkerHandle
  ),
  workerEntry(
    'pim-extraction-worker',
    () => extractionWorker,
    (v) => {
      extractionWorker = v;
    },
    startExtractionWorker,
    setExtractionWorkerHandle
  ),
  workerEntry(
    'pim-consensus-worker',
    () => consensusWorker,
    (v) => {
      consensusWorker = v;
    },
    startConsensusWorker,
    setConsensusWorkerHandle
  ),
  workerEntry(
    'pim-category-classifier-worker',
    () => categoryClassifierWorker,
    (v) => {
      categoryClassifierWorker = v;
    },
    startCategoryClassifierWorker,
    setCategoryClassifierWorkerHandle
  ),
  workerEntry(
    'pim-description-generator-worker',
    () => descriptionGeneratorWorker,
    (v) => {
      descriptionGeneratorWorker = v;
    },
    startDescriptionGeneratorWorker,
    setDescriptionGeneratorWorkerHandle
  ),
  workerEntry(
    'pim-metafield-push-worker',
    () => metafieldPushWorker,
    (v) => {
      metafieldPushWorker = v;
    },
    startMetafieldPushWorker,
    setMetafieldPushWorkerHandle
  ),
  workerEntry(
    'pim-budget-reset-worker',
    () => budgetResetScheduler,
    (v) => {
      budgetResetScheduler = v;
    },
    startBudgetResetScheduler,
    setBudgetResetSchedulerHandle
  ),
  workerEntry(
    'pim-weekly-summary-worker',
    () => weeklySummaryScheduler,
    (v) => {
      weeklySummaryScheduler = v;
    },
    startWeeklySummaryScheduler,
    setWeeklySummarySchedulerHandle
  ),
  workerEntry(
    'pim-mv-refresh-worker',
    () => mvRefreshScheduler,
    (v) => {
      mvRefreshScheduler = v;
    },
    startMvRefreshScheduler,
    setMvRefreshSchedulerHandle
  ),
  workerEntry(
    'pim-auto-enrichment-scheduler-worker',
    () => autoEnrichmentScheduler,
    (v) => {
      autoEnrichmentScheduler = v;
    },
    startAutoEnrichmentScheduler,
    setAutoEnrichmentSchedulerHandle
  ),
  workerEntry(
    'pim-raw-harvest-retention-worker',
    () => rawHarvestRetentionScheduler,
    (v) => {
      rawHarvestRetentionScheduler = v;
    },
    startRawHarvestRetentionScheduler,
    setRawHarvestRetentionSchedulerHandle
  ),
  workerEntry(
    'pim-quality-webhook-worker',
    () => qualityWebhookWorker,
    (v) => {
      qualityWebhookWorker = v;
    },
    startQualityWebhookWorker,
    setQualityWebhookWorkerHandle
  ),
  workerEntry(
    'pim-quality-webhook-sweep-worker',
    () => qualityWebhookSweepScheduler,
    (v) => {
      qualityWebhookSweepScheduler = v;
    },
    startQualityWebhookSweepScheduler,
    setQualityWebhookSweepSchedulerHandle
  ),
  workerEntry(
    'pim-collections-sync-worker',
    () => collectionsSyncWorker,
    (v) => {
      collectionsSyncWorker = v;
    },
    startCollectionsSyncWorker,
    setCollectionsSyncWorkerHandle
  ),
  workerEntry(
    'pim-collection-metafield-push-worker',
    () => collectionMetafieldPushWorker,
    (v) => {
      collectionMetafieldPushWorker = v;
    },
    startCollectionMetafieldPushWorker,
    setCollectionMetafieldPushWorkerHandle
  ),
  workerEntry(
    'collection-shopify-sync-worker',
    () => collectionShopifySyncWorker,
    (v) => {
      collectionShopifySyncWorker = v;
    },
    startCollectionShopifySyncWorker,
    setCollectionShopifySyncWorkerHandle
  ),
  workerEntry(
    'lex-extract-fragments-worker',
    () => lexExtractFragmentsWorker,
    (v) => {
      lexExtractFragmentsWorker = v;
    },
    startLexExtractFragmentsWorker,
    setLexExtractFragmentsWorkerHandle
  ),
  workerEntry(
    'lex-extract-entities-worker',
    () => lexExtractEntitiesWorker,
    (v) => {
      lexExtractEntitiesWorker = v;
    },
    startLexExtractEntitiesWorker,
    setLexExtractEntitiesWorkerHandle
  ),
  workerEntry(
    'lex-mine-terms-worker',
    () => lexMineTermsWorker,
    (v) => {
      lexMineTermsWorker = v;
    },
    startLexMineTermsWorker,
    setLexMineTermsWorkerHandle
  ),
  workerEntry(
    'lex-aggregate-stats-worker',
    () => lexAggregateStatsWorker,
    (v) => {
      lexAggregateStatsWorker = v;
    },
    startLexAggregateStatsWorker,
    setLexAggregateStatsWorkerHandle
  ),
  workerEntry(
    'lex-build-contexts-worker',
    () => lexBuildContextsWorker,
    (v) => {
      lexBuildContextsWorker = v;
    },
    startLexBuildContextsWorker,
    setLexBuildContextsWorkerHandle
  ),
  workerEntry(
    'lex-embed-contexts-worker',
    () => lexEmbedContextsWorker,
    (v) => {
      lexEmbedContextsWorker = v;
    },
    startLexEmbedContextsWorker,
    setLexEmbedContextsWorkerHandle
  ),
  workerEntry(
    'lex-cluster-senses-worker',
    () => lexClusterSensesWorker,
    (v) => {
      lexClusterSensesWorker = v;
    },
    startLexClusterSensesWorker,
    setLexClusterSensesWorkerHandle
  ),
  workerEntry(
    'lex-resolve-attributes-worker',
    () => lexResolveAttributesWorker,
    (v) => {
      lexResolveAttributesWorker = v;
    },
    startLexResolveAttributesWorker,
    setLexResolveAttributesWorkerHandle
  ),
  workerEntry(
    'lex-translate-candidates-worker',
    () => lexTranslateCandidatesWorker,
    (v) => {
      lexTranslateCandidatesWorker = v;
    },
    startLexTranslateCandidatesWorker,
    setLexTranslateCandidatesWorkerHandle
  ),
  workerEntry(
    'lex-compose-localizations-worker',
    () => lexComposeLocalizationsWorker,
    (v) => {
      lexComposeLocalizationsWorker = v;
    },
    startLexComposeLocalizationsWorker,
    setLexComposeLocalizationsWorkerHandle
  ),
  workerEntry(
    'lex-review-enqueue-worker',
    () => lexReviewEnqueueWorker,
    (v) => {
      lexReviewEnqueueWorker = v;
    },
    startLexReviewEnqueueWorker,
    setLexReviewEnqueueWorkerHandle
  ),
  workerEntry(
    'lex-publish-worker',
    () => lexPublishWorker,
    (v) => {
      lexPublishWorker = v;
    },
    startLexPublishWorker,
    setLexPublishWorkerHandle
  ),
  workerEntry(
    'lex-schedule-worker',
    () => lexScheduleWorker,
    (v) => {
      lexScheduleWorker = v;
    },
    startLexScheduleWorker,
    setLexScheduleWorkerHandle
  ),
  workerEntry(
    'lex-retention-compact-worker',
    () => lexRetentionWorker,
    (v) => {
      lexRetentionWorker = v;
    },
    startLexRetentionWorker,
    setLexRetentionWorkerHandle
  ),
];

function buildQueueConfigRegistry() {
  return {
    'webhook-queue': webhookWorker?.worker as unknown as { concurrency?: number },
    'sync-queue': syncWorker?.worker as unknown as { concurrency?: number },
    'bulk-queue': bulkOrchestratorWorker?.worker as unknown as { concurrency?: number },
    'bulk-poller-queue': bulkPollerWorker?.worker as unknown as { concurrency?: number },
    'bulk-mutation-reconcile-queue': bulkMutationReconcileWorker?.worker as unknown as {
      concurrency?: number;
    },
    'pim-manual-sync': pimManualSyncWorker?.worker as unknown as { concurrency?: number },
    'ai-batch-queue': aiBatchWorker?.worker as unknown as { concurrency?: number },
    'pim-enrichment-queue': enrichmentWorker?.worker as unknown as { concurrency?: number },
    'pim-similarity-search': similaritySearchWorker?.worker as unknown as { concurrency?: number },
    'pim-ai-audit': similarityAIAuditWorker?.worker as unknown as { concurrency?: number },
    'pim-extraction': extractionWorker?.worker as unknown as { concurrency?: number },
    'pim-consensus': consensusWorker?.worker as unknown as { concurrency?: number },
    'pim-mv-refresh-queue': mvRefreshScheduler?.worker as unknown as { concurrency?: number },
    'pim-auto-enrichment-scheduler-queue': autoEnrichmentScheduler?.worker as unknown as {
      concurrency?: number;
    },
    'pim-raw-harvest-retention-queue': rawHarvestRetentionScheduler?.worker as unknown as {
      concurrency?: number;
    },
    'pim-quality-webhook': qualityWebhookWorker?.worker as unknown as { concurrency?: number },
    'pim-quality-webhook-sweep': qualityWebhookSweepScheduler?.worker as unknown as {
      concurrency?: number;
    },
    'collection-shopify-sync': collectionShopifySyncWorker?.worker as unknown as {
      concurrency?: number;
    },
    'lex.extract.fragments': lexExtractFragmentsWorker?.worker as unknown as {
      concurrency?: number;
    },
    'lex.extract.entities': lexExtractEntitiesWorker?.worker as unknown as { concurrency?: number },
    'lex.mine.terms': lexMineTermsWorker?.worker as unknown as { concurrency?: number },
    'lex.aggregate.stats': lexAggregateStatsWorker?.worker as unknown as { concurrency?: number },
    'lex.build.contexts': lexBuildContextsWorker?.worker as unknown as { concurrency?: number },
    'lex.embed.contexts': lexEmbedContextsWorker?.worker as unknown as { concurrency?: number },
    'lex.cluster.senses': lexClusterSensesWorker?.worker as unknown as { concurrency?: number },
    'lex.resolve.attributes': lexResolveAttributesWorker?.worker as unknown as {
      concurrency?: number;
    },
    'lex.translate.candidates': lexTranslateCandidatesWorker?.worker as unknown as {
      concurrency?: number;
    },
    'lex.compose.localizations': lexComposeLocalizationsWorker?.worker as unknown as {
      concurrency?: number;
    },
    'lex.review.enqueue': lexReviewEnqueueWorker?.worker as unknown as { concurrency?: number },
    'lex.publish': lexPublishWorker?.worker as unknown as { concurrency?: number },
    'lex.retention.compact': lexRetentionWorker?.worker as unknown as { concurrency?: number },
  };
}

async function recreateRedisDependentWorkers(newRedisUrl: string): Promise<void> {
  logger.warn({ newRedisUrl }, 'Recreating Redis-dependent workers');

  if (queueConfigListener) {
    await queueConfigListener.quit().catch(() => undefined);
    queueConfigListener = null;
  }

  for (const entry of WORKER_ENTRIES) {
    await entry.recreate(logger);
  }

  queueConfigListener = await startQueueConfigListener(env, logger, buildQueueConfigRegistry());
  logger.warn({}, 'Redis-dependent workers recreated successfully');
}

try {
  await startCredentialWatcher();
  registerWorkerRecreator('backend-worker-runtime', recreateRedisDependentWorkers);
  logger.info({}, 'credential watcher started');

  await server.listen({ port: env.port, host: '0.0.0.0' });
  logger.info({ port: env.port }, 'server listening');

  webhookWorker = startWebhookWorker(logger);
  setWebhookWorkerHandle(webhookWorker);
  logger.info({}, 'webhook worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'webhook-worker',
    timestamp: new Date().toISOString(),
  });

  tokenHealthWorker = startTokenHealthWorker(logger);
  setTokenHealthWorkerHandle(tokenHealthWorker);
  logger.info({}, 'token health worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'token-health-worker',
    timestamp: new Date().toISOString(),
  });

  await scheduleTokenHealthJob(logger);

  syncWorker = startSyncWorker(logger);
  logger.info({}, 'sync worker started');
  setSyncWorkerHandle(syncWorker);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'sync-worker',
    timestamp: new Date().toISOString(),
  });

  bulkOrchestratorWorker = startBulkOrchestratorWorker(logger);
  setBulkOrchestratorWorkerHandle(bulkOrchestratorWorker);
  logger.info({}, 'bulk orchestrator worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'bulk-orchestrator-worker',
    timestamp: new Date().toISOString(),
  });

  bulkPollerWorker = startBulkPollerWorker(logger);
  setBulkPollerWorkerHandle(bulkPollerWorker);
  logger.info({}, 'bulk poller worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'bulk-poller-worker',
    timestamp: new Date().toISOString(),
  });

  bulkMutationReconcileWorker = startBulkMutationReconcileWorker(logger);
  setBulkMutationReconcileWorkerHandle(bulkMutationReconcileWorker);
  logger.info({}, 'bulk mutation reconcile worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'bulk-mutation-reconcile-worker',
    timestamp: new Date().toISOString(),
  });

  bulkIngestWorker = startBulkIngestWorker(logger);
  setBulkIngestWorkerHandle(bulkIngestWorker);
  logger.info({}, 'bulk ingest worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'bulk-ingest-worker',
    timestamp: new Date().toISOString(),
  });

  pimManualSyncWorker = startPimManualSyncWorker(logger);
  setPimManualSyncWorkerHandle(pimManualSyncWorker);
  logger.info({}, 'pim manual sync worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-manual-sync-worker',
    timestamp: new Date().toISOString(),
  });

  bulkScheduleWorker = startBulkScheduleWorker(logger);
  logger.info({}, 'bulk schedule worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'bulk-schedule-worker',
    timestamp: new Date().toISOString(),
  });

  aiBatchWorker = startAiBatchWorker(logger);
  setAiBatchWorkerHandle(aiBatchWorker);
  logger.info({}, 'ai batch worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'ai-batch-worker',
    timestamp: new Date().toISOString(),
  });

  aiBatchScheduleWorker = startAiBatchScheduleWorker(logger);
  logger.info({}, 'ai batch schedule worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'ai-batch-schedule-worker',
    timestamp: new Date().toISOString(),
  });

  openAiHealthWorker = startOpenAiHealthWorker(logger);
  logger.info({}, 'openai health worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'openai-health-worker',
    timestamp: new Date().toISOString(),
  });

  serperHealthWorker = startSerperHealthWorker(logger);
  logger.info({}, 'serper health worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'serper-health-worker',
    timestamp: new Date().toISOString(),
  });

  xaiHealthWorker = startXaiHealthWorker(logger);
  logger.info({}, 'xai health worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'xai-health-worker',
    timestamp: new Date().toISOString(),
  });

  selfHostedHealthWorker = startSelfHostedHealthWorker(logger);
  logger.info({}, 'selfhosted health worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'selfhosted-health-worker',
    timestamp: new Date().toISOString(),
  });

  enrichmentWorker = startEnrichmentWorker(logger);
  logger.info({}, 'enrichment worker started');
  setEnrichmentWorkerHandle(enrichmentWorker);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'enrichment-worker',
    timestamp: new Date().toISOString(),
  });

  similaritySearchWorker = startSimilaritySearchWorker(logger);
  logger.info({}, 'similarity search worker started');
  setSimilaritySearchWorkerHandle(similaritySearchWorker);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'similarity-search-worker',
    timestamp: new Date().toISOString(),
  });

  similarityAIAuditWorker = startAIAuditWorker(logger);
  logger.info({}, 'similarity AI audit worker started');
  setSimilarityAIAuditWorkerHandle(similarityAIAuditWorker);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'ai-audit-worker',
    timestamp: new Date().toISOString(),
  });

  extractionWorker = startExtractionWorker(logger);
  logger.info({}, 'pim extraction worker started');
  setExtractionWorkerHandle(extractionWorker);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-extraction-worker',
    timestamp: new Date().toISOString(),
  });

  consensusWorker = startConsensusWorker(logger);
  logger.info({}, 'pim consensus worker started');
  setConsensusWorkerHandle(consensusWorker);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-consensus-worker',
    timestamp: new Date().toISOString(),
  });

  categoryClassifierWorker = startCategoryClassifierWorker(logger);
  logger.info({}, 'pim category classifier worker started');
  setCategoryClassifierWorkerHandle(categoryClassifierWorker);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-category-classifier-worker',
    timestamp: new Date().toISOString(),
  });

  descriptionGeneratorWorker = startDescriptionGeneratorWorker(logger);
  logger.info({}, 'pim description generator worker started');
  setDescriptionGeneratorWorkerHandle(descriptionGeneratorWorker);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-description-generator-worker',
    timestamp: new Date().toISOString(),
  });

  metafieldPushWorker = startMetafieldPushWorker(logger);
  logger.info({}, 'pim metafield push worker started');
  setMetafieldPushWorkerHandle(metafieldPushWorker);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-metafield-push-worker',
    timestamp: new Date().toISOString(),
  });

  budgetResetScheduler = startBudgetResetScheduler(logger);
  logger.info({}, 'pim budget reset scheduler started');
  setBudgetResetSchedulerHandle(budgetResetScheduler);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-budget-reset-worker',
    timestamp: new Date().toISOString(),
  });

  weeklySummaryScheduler = startWeeklySummaryScheduler(logger);
  logger.info({}, 'pim weekly summary scheduler started');
  setWeeklySummarySchedulerHandle(weeklySummaryScheduler);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-weekly-summary-worker',
    timestamp: new Date().toISOString(),
  });

  autoEnrichmentScheduler = startAutoEnrichmentScheduler(logger);
  logger.info({}, 'pim auto enrichment scheduler started');
  setAutoEnrichmentSchedulerHandle(autoEnrichmentScheduler);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-auto-enrichment-scheduler-worker',
    timestamp: new Date().toISOString(),
  });

  rawHarvestRetentionScheduler = startRawHarvestRetentionScheduler(logger);
  logger.info({}, 'pim raw harvest retention scheduler started');
  setRawHarvestRetentionSchedulerHandle(rawHarvestRetentionScheduler);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-raw-harvest-retention-worker',
    timestamp: new Date().toISOString(),
  });

  mvRefreshScheduler = startMvRefreshScheduler(logger);
  logger.info({}, 'pim mv refresh scheduler started');
  setMvRefreshSchedulerHandle(mvRefreshScheduler);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-mv-refresh-worker',
    timestamp: new Date().toISOString(),
  });

  qualityWebhookWorker = startQualityWebhookWorker(logger);
  logger.info({}, 'pim quality webhook worker started');
  setQualityWebhookWorkerHandle(qualityWebhookWorker);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-quality-webhook-worker',
    timestamp: new Date().toISOString(),
  });

  qualityWebhookSweepScheduler = startQualityWebhookSweepScheduler(logger);
  logger.info({}, 'pim quality webhook sweep scheduler started');
  setQualityWebhookSweepSchedulerHandle(qualityWebhookSweepScheduler);
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-quality-webhook-sweep-worker',
    timestamp: new Date().toISOString(),
  });

  collectionsSyncWorker = startCollectionsSyncWorker(logger);
  setCollectionsSyncWorkerHandle(collectionsSyncWorker);
  logger.info({}, 'collections sync worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-collections-sync-worker',
    timestamp: new Date().toISOString(),
  });

  collectionMetafieldPushWorker = startCollectionMetafieldPushWorker(logger);
  setCollectionMetafieldPushWorkerHandle(collectionMetafieldPushWorker);
  logger.info({}, 'collection metafield push worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'pim-collection-metafield-push-worker',
    timestamp: new Date().toISOString(),
  });

  collectionShopifySyncWorker = startCollectionShopifySyncWorker(logger);
  setCollectionShopifySyncWorkerHandle(collectionShopifySyncWorker);
  logger.info({}, 'collection shopify sync worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'collection-shopify-sync-worker',
    timestamp: new Date().toISOString(),
  });

  lexExtractFragmentsWorker = startLexExtractFragmentsWorker(logger);
  setLexExtractFragmentsWorkerHandle(lexExtractFragmentsWorker);
  logger.info({}, 'lex extract fragments worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-extract-fragments-worker',
    timestamp: new Date().toISOString(),
  });

  lexExtractEntitiesWorker = startLexExtractEntitiesWorker(logger);
  setLexExtractEntitiesWorkerHandle(lexExtractEntitiesWorker);
  logger.info({}, 'lex extract entities worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-extract-entities-worker',
    timestamp: new Date().toISOString(),
  });

  lexMineTermsWorker = startLexMineTermsWorker(logger);
  setLexMineTermsWorkerHandle(lexMineTermsWorker);
  logger.info({}, 'lex mine terms worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-mine-terms-worker',
    timestamp: new Date().toISOString(),
  });

  lexAggregateStatsWorker = startLexAggregateStatsWorker(logger);
  setLexAggregateStatsWorkerHandle(lexAggregateStatsWorker);
  logger.info({}, 'lex aggregate stats worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-aggregate-stats-worker',
    timestamp: new Date().toISOString(),
  });

  lexBuildContextsWorker = startLexBuildContextsWorker(logger);
  setLexBuildContextsWorkerHandle(lexBuildContextsWorker);
  logger.info({}, 'lex build contexts worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-build-contexts-worker',
    timestamp: new Date().toISOString(),
  });

  lexEmbedContextsWorker = startLexEmbedContextsWorker(logger);
  setLexEmbedContextsWorkerHandle(lexEmbedContextsWorker);
  logger.info({}, 'lex embed contexts worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-embed-contexts-worker',
    timestamp: new Date().toISOString(),
  });

  lexClusterSensesWorker = startLexClusterSensesWorker(logger);
  setLexClusterSensesWorkerHandle(lexClusterSensesWorker);
  logger.info({}, 'lex cluster senses worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-cluster-senses-worker',
    timestamp: new Date().toISOString(),
  });

  lexResolveAttributesWorker = startLexResolveAttributesWorker(logger);
  setLexResolveAttributesWorkerHandle(lexResolveAttributesWorker);
  logger.info({}, 'lex resolve attributes worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-resolve-attributes-worker',
    timestamp: new Date().toISOString(),
  });

  lexTranslateCandidatesWorker = startLexTranslateCandidatesWorker(logger);
  setLexTranslateCandidatesWorkerHandle(lexTranslateCandidatesWorker);
  logger.info({}, 'lex translate candidates worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-translate-candidates-worker',
    timestamp: new Date().toISOString(),
  });

  lexComposeLocalizationsWorker = startLexComposeLocalizationsWorker(logger);
  setLexComposeLocalizationsWorkerHandle(lexComposeLocalizationsWorker);
  logger.info({}, 'lex compose localizations worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-compose-localizations-worker',
    timestamp: new Date().toISOString(),
  });

  lexReviewEnqueueWorker = startLexReviewEnqueueWorker(logger);
  setLexReviewEnqueueWorkerHandle(lexReviewEnqueueWorker);
  logger.info({}, 'lex review enqueue worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-review-enqueue-worker',
    timestamp: new Date().toISOString(),
  });

  lexPublishWorker = startLexPublishWorker(logger);
  setLexPublishWorkerHandle(lexPublishWorker);
  logger.info({}, 'lex publish worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-publish-worker',
    timestamp: new Date().toISOString(),
  });

  for (const shopId of await listLexEnabledShops().catch(() => [])) {
    await reconcileLexScheduledTasks({ shopId, enabled: true }).catch(() => undefined);
  }

  lexScheduleWorker = startLexScheduleWorker(logger);
  setLexScheduleWorkerHandle(lexScheduleWorker);
  logger.info({}, 'lex schedule worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-schedule-worker',
    timestamp: new Date().toISOString(),
  });

  lexRetentionWorker = startLexRetentionWorker(logger);
  setLexRetentionWorkerHandle(lexRetentionWorker);
  logger.info({}, 'lex retention worker started');
  emitQueueStreamEvent({
    type: 'worker.online',
    workerId: 'lex-retention-compact-worker',
    timestamp: new Date().toISOString(),
  });

  budgetGaugeRedis = createManagedRedis('budget-gauge', {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
  });
  const refreshBudgetMetrics = async (): Promise<void> => {
    const budgetRatioParams: Parameters<typeof refreshPimBudgetUsageRatios>[0] = {
      getMaxRatios: getMaxBudgetRatios,
    };
    if (budgetGaugeRedis) {
      const redis = budgetGaugeRedis;
      budgetRatioParams.cache = {
        get: (key) => redis.get(key),
        setex: (key, ttlSeconds, value) => redis.setex(key, ttlSeconds, value),
      };
    }
    await refreshPimBudgetUsageRatios(budgetRatioParams);
  };
  await refreshBudgetMetrics();
  budgetGaugeInterval = setInterval(() => {
    void refreshBudgetMetrics();
  }, 15_000);

  queueConfigListener = await startQueueConfigListener(env, logger, buildQueueConfigRegistry());
  logger.info({}, 'queue config listener started');
} catch (error) {
  logger.fatal({ error }, 'server failed to start');
  process.exitCode = 1;
}

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'shutdown started');
  try {
    for (const entry of WORKER_ENTRIES) {
      const wasRunning = await entry.teardown();
      if (wasRunning) {
        logger.info({ signal }, `${entry.workerId} stopped`);
        emitQueueStreamEvent({
          type: 'worker.offline',
          workerId: entry.workerId,
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (queueConfigListener) {
      await queueConfigListener.quit().catch(() => undefined);
      queueConfigListener = null;
      logger.info({ signal }, 'queue config listener stopped');
    }

    if (budgetGaugeInterval) {
      clearInterval(budgetGaugeInterval);
      budgetGaugeInterval = null;
    }
    if (budgetGaugeRedis) {
      await budgetGaugeRedis.quit();
      budgetGaugeRedis = null;
    }
    await closeManagedRedisConnections();

    await closeTokenHealthQueue();
    await closeSimilarityQueues();
    await closeQualityWebhookQueue();
    await closeConsensusQueue();
    await closeCategoryClassifierQueue();
    await closeDescriptionGeneratorQueue();
    await closeMetafieldPushQueue();
    await closePimManualSyncQueue();
    await closeEnrichmentQueue();
    await closeCollectionsSyncQueue();
    await closeCollectionMetafieldPushQueue();
    await closeCollectionShopifySyncQueue();
    await closeLexQueues();

    stopCredentialWatcher();
    await closePimPool();
    await closePool();
    logger.info({ signal }, 'database pools closed (main + PIM)');

    await server.close();
    logger.info({ signal }, 'shutdown complete');
  } catch (error) {
    logger.error({ error, signal }, 'shutdown failed');
  }
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
