import type { AppEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import {
  configFromEnv,
  createQueue,
  toDlqQueueName,
  type KnownQueueName,
} from '@app/queue-manager';
import type {
  LexHealthAlertDto,
  LexMetricsDto,
  LexQueueHealthDto,
  LexWorkerHealthDto,
} from '@app/types';

import { setLexMetricsSnapshot, setLexWorkersOnline } from '../otel/metrics.js';
import { getWorkerCurrentJob, getWorkerReadiness } from '../runtime/worker-registry.js';
import type { TenantClient } from '../processors/lex/pipeline-types.js';

const LEX_EXTRACT_FRAGMENTS_QUEUE_NAME = 'lex.extract.fragments';
const LEX_EXTRACT_ENTITIES_QUEUE_NAME = 'lex.extract.entities';
const LEX_MINE_TERMS_QUEUE_NAME = 'lex.mine.terms';
const LEX_AGGREGATE_STATS_QUEUE_NAME = 'lex.aggregate.stats';
const LEX_BUILD_CONTEXTS_QUEUE_NAME = 'lex.build.contexts';
const LEX_EMBED_CONTEXTS_QUEUE_NAME = 'lex.embed.contexts';
const LEX_CLUSTER_SENSES_QUEUE_NAME = 'lex.cluster.senses';
const LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME = 'lex.resolve.attributes';
const LEX_TRANSLATE_CANDIDATES_QUEUE_NAME = 'lex.translate.candidates';
const LEX_COMPOSE_LOCALIZATIONS_QUEUE_NAME = 'lex.compose.localizations';
const LEX_REVIEW_ENQUEUE_QUEUE_NAME = 'lex.review.enqueue';
const LEX_PUBLISH_QUEUE_NAME = 'lex.publish';
const LEX_RETENTION_COMPACT_QUEUE_NAME = 'lex.retention.compact';

const LEX_QUEUE_NAMES = [
  LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
  LEX_EXTRACT_ENTITIES_QUEUE_NAME,
  LEX_MINE_TERMS_QUEUE_NAME,
  LEX_AGGREGATE_STATS_QUEUE_NAME,
  LEX_BUILD_CONTEXTS_QUEUE_NAME,
  LEX_EMBED_CONTEXTS_QUEUE_NAME,
  LEX_CLUSTER_SENSES_QUEUE_NAME,
  LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME,
  LEX_TRANSLATE_CANDIDATES_QUEUE_NAME,
  LEX_COMPOSE_LOCALIZATIONS_QUEUE_NAME,
  LEX_REVIEW_ENQUEUE_QUEUE_NAME,
  LEX_PUBLISH_QUEUE_NAME,
  LEX_RETENTION_COMPACT_QUEUE_NAME,
] as const satisfies readonly KnownQueueName[];

type LexReadiness = ReturnType<typeof getWorkerReadiness>;

type LexWorkerDefinition = Readonly<{
  id: string;
  label: string;
  readinessKey: keyof LexReadiness;
  queueName: KnownQueueName | null;
}>;

export const LEX_WORKER_DEFINITIONS: readonly LexWorkerDefinition[] = [
  {
    id: 'lex-extract-fragments-worker',
    label: 'Lex Extract Fragments',
    readinessKey: 'lexExtractFragmentsWorkerOk',
    queueName: LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
  },
  {
    id: 'lex-extract-entities-worker',
    label: 'Lex Extract Entities',
    readinessKey: 'lexExtractEntitiesWorkerOk',
    queueName: LEX_EXTRACT_ENTITIES_QUEUE_NAME,
  },
  {
    id: 'lex-mine-terms-worker',
    label: 'Lex Mine Terms',
    readinessKey: 'lexMineTermsWorkerOk',
    queueName: LEX_MINE_TERMS_QUEUE_NAME,
  },
  {
    id: 'lex-aggregate-stats-worker',
    label: 'Lex Aggregate Stats',
    readinessKey: 'lexAggregateStatsWorkerOk',
    queueName: LEX_AGGREGATE_STATS_QUEUE_NAME,
  },
  {
    id: 'lex-build-contexts-worker',
    label: 'Lex Build Contexts',
    readinessKey: 'lexBuildContextsWorkerOk',
    queueName: LEX_BUILD_CONTEXTS_QUEUE_NAME,
  },
  {
    id: 'lex-embed-contexts-worker',
    label: 'Lex Embed Contexts',
    readinessKey: 'lexEmbedContextsWorkerOk',
    queueName: LEX_EMBED_CONTEXTS_QUEUE_NAME,
  },
  {
    id: 'lex-cluster-senses-worker',
    label: 'Lex Cluster Senses',
    readinessKey: 'lexClusterSensesWorkerOk',
    queueName: LEX_CLUSTER_SENSES_QUEUE_NAME,
  },
  {
    id: 'lex-resolve-attributes-worker',
    label: 'Lex Resolve Attributes',
    readinessKey: 'lexResolveAttributesWorkerOk',
    queueName: LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME,
  },
  {
    id: 'lex-translate-candidates-worker',
    label: 'Lex Translate Candidates',
    readinessKey: 'lexTranslateCandidatesWorkerOk',
    queueName: LEX_TRANSLATE_CANDIDATES_QUEUE_NAME,
  },
  {
    id: 'lex-compose-localizations-worker',
    label: 'Lex Compose Localizations',
    readinessKey: 'lexComposeLocalizationsWorkerOk',
    queueName: LEX_COMPOSE_LOCALIZATIONS_QUEUE_NAME,
  },
  {
    id: 'lex-review-enqueue-worker',
    label: 'Lex Review Enqueue',
    readinessKey: 'lexReviewEnqueueWorkerOk',
    queueName: LEX_REVIEW_ENQUEUE_QUEUE_NAME,
  },
  {
    id: 'lex-publish-worker',
    label: 'Lex Publish',
    readinessKey: 'lexPublishWorkerOk',
    queueName: LEX_PUBLISH_QUEUE_NAME,
  },
  {
    id: 'lex-schedule-worker',
    label: 'Lex Scheduler',
    readinessKey: 'lexScheduleWorkerOk',
    queueName: null,
  },
  {
    id: 'lex-retention-compact-worker',
    label: 'Lex Retention',
    readinessKey: 'lexRetentionWorkerOk',
    queueName: LEX_RETENTION_COMPACT_QUEUE_NAME,
  },
] as const;

type LexQueueCounts = Readonly<{
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  dlqEntries: number;
  errorMessage: string | null;
}>;

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toOptionalFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildQueueUrl(queueName: string, tab: 'overview' | 'jobs' | 'workers' = 'jobs'): string {
  const params = new URLSearchParams();
  params.set('tab', tab);
  params.set('queue', queueName);
  return `/queues?${params.toString()}`;
}

export function buildLexPublicationQueueLinks(): {
  queueName: string;
  queueUrl: string;
  dlqQueueName: string;
  dlqUrl: string;
} {
  const queueName = LEX_PUBLISH_QUEUE_NAME;
  const dlqQueueName = toDlqQueueName(queueName);
  return {
    queueName,
    queueUrl: buildQueueUrl(queueName),
    dlqQueueName,
    dlqUrl: buildQueueUrl(dlqQueueName),
  };
}

async function getLexQueueCounts(env: AppEnv, queueName: KnownQueueName): Promise<LexQueueCounts> {
  const config = configFromEnv(env);
  const queue = createQueue({ config }, { name: queueName });
  const dlqQueueName = toDlqQueueName(queueName);
  const dlqQueue = createQueue({ config }, { name: dlqQueueName });

  try {
    try {
      const [counts, dlqCounts] = await Promise.all([
        queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
        dlqQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      ]);

      return {
        waiting: counts['waiting'] ?? 0,
        active: counts['active'] ?? 0,
        delayed: counts['delayed'] ?? 0,
        failed: counts['failed'] ?? 0,
        completed: counts['completed'] ?? 0,
        dlqEntries:
          (dlqCounts['waiting'] ?? 0) +
          (dlqCounts['active'] ?? 0) +
          (dlqCounts['delayed'] ?? 0) +
          (dlqCounts['failed'] ?? 0),
        errorMessage: null,
      };
    } catch (error) {
      return {
        waiting: 0,
        active: 0,
        delayed: 0,
        failed: 0,
        completed: 0,
        dlqEntries: 0,
        errorMessage: error instanceof Error ? error.message : 'queue_metrics_unavailable',
      };
    }
  } finally {
    await Promise.allSettled([queue.close(), dlqQueue.close()]);
  }
}

function buildWorkerHealth(): {
  workers: LexWorkerHealthDto[];
  workersOnline: number;
} {
  const readiness = getWorkerReadiness();

  const workers = LEX_WORKER_DEFINITIONS.map((definition): LexWorkerHealthDto => {
    const queueName = definition.queueName;
    const dlqQueueName = queueName ? toDlqQueueName(queueName) : null;
    return {
      id: definition.id,
      label: definition.label,
      ok: Boolean(readiness[definition.readinessKey]),
      queueName,
      queueUrl: queueName ? buildQueueUrl(queueName) : null,
      dlqQueueName,
      dlqUrl: dlqQueueName ? buildQueueUrl(dlqQueueName) : null,
      currentJob: getWorkerCurrentJob(definition.id),
    };
  });

  const workersOnline = workers.filter((worker) => worker.ok).length;
  setLexWorkersOnline(workersOnline);
  return { workers, workersOnline };
}

function buildHealthAlerts(params: {
  metrics: Pick<
    LexMetricsDto,
    | 'runsPaused'
    | 'pausedBudgetBlocked'
    | 'pausedProviderUnavailable'
    | 'shardsFailed'
    | 'staleCheckpoints'
    | 'publishConflicts'
    | 'publicationsFailed'
    | 'retentionLag'
    | 'dlqEntries'
    | 'tmHits'
    | 'tmMisses'
    | 'tmHitRatePercent'
  >;
  queues: LexQueueHealthDto[];
  workers: LexWorkerHealthDto[];
  queueErrors: { queueName: string; message: string }[];
}): LexHealthAlertDto[] {
  const alerts: LexHealthAlertDto[] = [];

  if (params.metrics.staleCheckpoints > 0) {
    alerts.push({
      key: 'stale-checkpoints',
      severity: 'critical',
      message: `${params.metrics.staleCheckpoints} checkpoint-uri lex sunt stale (>15m).`,
      href: buildQueueUrl(LEX_EXTRACT_FRAGMENTS_QUEUE_NAME),
      queueName: LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
      workerId: null,
    });
  }

  if (params.metrics.dlqEntries > 0) {
    const queueWithDlq = params.queues.find((queue) => queue.dlqEntries > 0);
    alerts.push({
      key: 'lex-dlq-present',
      severity: 'critical',
      message: `${params.metrics.dlqEntries} job-uri lex sunt în DLQ.`,
      href: queueWithDlq?.dlqUrl ?? buildQueueUrl(toDlqQueueName(LEX_PUBLISH_QUEUE_NAME)),
      queueName: queueWithDlq?.dlqQueueName ?? toDlqQueueName(LEX_PUBLISH_QUEUE_NAME),
      workerId: null,
    });
  }

  if (params.metrics.publishConflicts > 0) {
    alerts.push({
      key: 'publish-conflicts',
      severity: 'warning',
      message: `${params.metrics.publishConflicts} publish conflicts așteaptă intervenție umană.`,
      href: '/pim/translations?tab=review',
      queueName: null,
      workerId: null,
    });
  }

  if (params.metrics.publicationsFailed > 0) {
    alerts.push({
      key: 'publication-failures',
      severity: 'warning',
      message: `${params.metrics.publicationsFailed} publication targets sunt în stare failed.`,
      href: '/pim/translations?tab=publications',
      queueName: LEX_PUBLISH_QUEUE_NAME,
      workerId: 'lex-publish-worker',
    });
  }

  if (params.metrics.shardsFailed > 0) {
    alerts.push({
      key: 'failed-shards',
      severity: 'warning',
      message: `${params.metrics.shardsFailed} shards lex au eșuat și trebuie investigate.`,
      href: '/pim/translations?tab=runs',
      queueName: null,
      workerId: null,
    });
  }

  if (params.metrics.pausedBudgetBlocked > 0) {
    alerts.push({
      key: 'paused-budget-blocked',
      severity: 'warning',
      message: `${params.metrics.pausedBudgetBlocked} run-uri lex sunt în pauză din cauza bugetului.`,
      href: '/pim/translations?tab=runs',
      queueName: null,
      workerId: null,
    });
  }

  if (params.metrics.pausedProviderUnavailable > 0) {
    alerts.push({
      key: 'paused-provider-unavailable',
      severity: 'warning',
      message: `${params.metrics.pausedProviderUnavailable} run-uri lex sunt în pauză din cauza providerului.`,
      href: '/pim/translations?tab=runs',
      queueName: null,
      workerId: null,
    });
  }

  const pausedOther =
    params.metrics.runsPaused -
    params.metrics.pausedBudgetBlocked -
    params.metrics.pausedProviderUnavailable;
  if (pausedOther > 0) {
    alerts.push({
      key: 'paused-runs',
      severity: 'warning',
      message: `${pausedOther} run-uri lex sunt în pauză.`,
      href: '/pim/translations?tab=runs',
      queueName: null,
      workerId: null,
    });
  }

  if (params.metrics.retentionLag > 24 * 60 * 60) {
    alerts.push({
      key: 'retention-lag',
      severity: 'warning',
      message: `Retention lag lexical depășește 24h (${params.metrics.retentionLag}s).`,
      href: buildQueueUrl(LEX_RETENTION_COMPACT_QUEUE_NAME),
      queueName: LEX_RETENTION_COMPACT_QUEUE_NAME,
      workerId: 'lex-retention-compact-worker',
    });
  }

  for (const worker of params.workers.filter((entry) => !entry.ok)) {
    alerts.push({
      key: `worker-offline:${worker.id}`,
      severity: 'critical',
      message: `${worker.label} este offline.`,
      href: worker.queueUrl ?? '/queues?tab=workers',
      queueName: worker.queueName,
      workerId: worker.id,
    });
  }

  for (const queueError of params.queueErrors) {
    alerts.push({
      key: `queue-metrics-unavailable:${queueError.queueName}`,
      severity: 'warning',
      message: `Nu am putut încărca metricile pentru coada ${queueError.queueName}: ${queueError.message}`,
      href: buildQueueUrl(queueError.queueName),
      queueName: queueError.queueName,
      workerId: null,
    });
  }

  const tmAttempts = params.metrics.tmHits + params.metrics.tmMisses;
  if (tmAttempts >= 100 && params.metrics.tmHitRatePercent < 30) {
    alerts.push({
      key: 'tm-hit-rate-low',
      severity: 'warning',
      message: `TM hit rate sub 30%: ${params.metrics.tmHitRatePercent.toFixed(1)}% (${params.metrics.tmHits}/${tmAttempts}).`,
      href: '/pim/translations?tab=settings',
      queueName: null,
      workerId: null,
    });
  }

  return alerts;
}

async function collectLexBaseMetrics(
  client: TenantClient,
  shopId: string
): Promise<{
  runsTotal: number;
  termsTotal: number;
  clustersTotal: number;
  glossaryTotal: number;
  reviewPending: number;
  reviewBacklog: number;
  localizationsApproved: number;
  publicationsPending: number;
  runsActive: number;
  runsPaused: number;
  pausedBudgetBlocked: number;
  pausedProviderUnavailable: number;
  shardsFailed: number;
  publicationsFailed: number;
  publishConflicts: number;
  staleCheckpoints: number;
  retentionLag: number;
  aiBatchBacklog: number;
  tmHits: number;
  tmMisses: number;
  tmHitRatePercent: number;
  tmMissRatePercent: number;
  tmAverageSimilarity: number | null;
}> {
  const result = await client.query<{
    runsTotal: string;
    termsTotal: string;
    clustersTotal: string;
    glossaryTotal: string;
    reviewPending: string;
    reviewBacklog: string;
    localizationsApproved: string;
    publicationsPending: string;
    runsActive: string;
    runsPaused: string;
    pausedBudgetBlocked: string;
    pausedProviderUnavailable: string;
    shardsFailed: string;
    publicationsFailed: string;
    publishConflicts: string;
    staleCheckpoints: string;
    retentionLag: string;
    aiBatchBacklog: string;
    tmHits: string;
    tmMisses: string;
    tmAverageSimilarity: string | null;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM lex_runs WHERE shop_id = $1) AS "runsTotal",
       (SELECT COUNT(*)::text FROM lex_effective_terms WHERE shop_id = $1 OR shop_id IS NULL) AS "termsTotal",
       (SELECT COUNT(*)::text FROM lex_sense_clusters WHERE shop_id = $1 OR shop_id IS NULL) AS "clustersTotal",
       (SELECT COUNT(*)::text FROM lex_effective_glossary_entries WHERE shop_id = $1 OR shop_id IS NULL) AS "glossaryTotal",
       (SELECT COUNT(*)::text FROM lex_review_items WHERE shop_id = $1 AND status = 'pending') AS "reviewPending",
       (SELECT COUNT(*)::text FROM lex_review_items WHERE shop_id = $1 AND status IN ('pending', 'in_review')) AS "reviewBacklog",
       (SELECT COUNT(*)::text FROM lex_entity_localizations WHERE shop_id = $1 AND publication_status IN ('approved', 'published')) AS "localizationsApproved",
       (SELECT COUNT(*)::text FROM lex_publication_targets WHERE shop_id = $1 AND status IN ('pending', 'publishing')) AS "publicationsPending",
       (SELECT COUNT(*)::text FROM lex_runs WHERE shop_id = $1 AND status IN ('pending', 'running', 'paused')) AS "runsActive",
       (SELECT COUNT(*)::text FROM lex_runs WHERE shop_id = $1 AND status = 'paused') AS "runsPaused",
       (SELECT COUNT(*)::text FROM lex_runs WHERE shop_id = $1 AND status = 'paused' AND pause_reason = 'budget_blocked') AS "pausedBudgetBlocked",
       (SELECT COUNT(*)::text FROM lex_runs WHERE shop_id = $1 AND status = 'paused' AND pause_reason = 'provider_unavailable') AS "pausedProviderUnavailable",
       (SELECT COUNT(*)::text FROM lex_run_shards WHERE shop_id = $1 AND status = 'failed') AS "shardsFailed",
       (SELECT COUNT(*)::text FROM lex_publication_targets WHERE shop_id = $1 AND status = 'failed') AS "publicationsFailed",
       (SELECT COUNT(*)::text FROM lex_review_items WHERE shop_id = $1 AND review_reason = 'publish_conflict' AND status IN ('pending', 'in_review')) AS "publishConflicts",
       (SELECT COUNT(*)::text FROM lex_checkpoints WHERE shop_id = $1 AND status = 'active' AND heartbeat_at < now() - interval '15 minutes') AS "staleCheckpoints",
       (SELECT GREATEST(
                 0,
                 COALESCE(
                   (SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at)))::bigint
                    FROM lex_fragments
                    WHERE shop_id = $1),
                   0
                 )
                 - COALESCE(
                     (SELECT retention_days_fragments::bigint
                      FROM lex_shop_settings
                      WHERE shop_id = $1
                      LIMIT 1),
                     90
                   ) * 86400
               )::text) AS "retentionLag",
       (SELECT COUNT(*)::text FROM ai_batch_items WHERE shop_id = $1 AND entity_type IN ('lex_term_context', 'lex_sense_cluster') AND status IN ('pending', 'processing')) AS "aiBatchBacklog",
       (SELECT COALESCE(SUM((d.details->>'tmHits')::bigint), 0)::text
        FROM lex_run_phase_events d
        WHERE d.shop_id = $1
          AND d.phase_name = 'translate.candidates'
          AND d.event_type = 'shard_completed') AS "tmHits",
       (SELECT COALESCE(SUM((d.details->>'tmMisses')::bigint), 0)::text
        FROM lex_run_phase_events d
        WHERE d.shop_id = $1
          AND d.phase_name = 'translate.candidates'
          AND d.event_type = 'shard_completed') AS "tmMisses",
       (SELECT
          CASE
            WHEN COALESCE(
              SUM((d.details->>'tmHits')::bigint) FILTER (WHERE d.details ? 'tmSimilaritySum'),
              0
            ) > 0
            THEN (
              SUM((d.details->>'tmSimilaritySum')::double precision)
                FILTER (WHERE d.details ? 'tmSimilaritySum')
              / NULLIF(
                  SUM((d.details->>'tmHits')::bigint) FILTER (WHERE d.details ? 'tmSimilaritySum'),
                  0
                )::double precision
            )::text
            ELSE NULL
          END
        FROM lex_run_phase_events d
        WHERE d.shop_id = $1
          AND d.phase_name = 'translate.candidates'
          AND d.event_type = 'shard_completed') AS "tmAverageSimilarity"`,
    [shopId]
  );

  const row = result.rows[0] ?? {
    runsTotal: '0',
    termsTotal: '0',
    clustersTotal: '0',
    glossaryTotal: '0',
    reviewPending: '0',
    reviewBacklog: '0',
    localizationsApproved: '0',
    publicationsPending: '0',
    runsActive: '0',
    runsPaused: '0',
    pausedBudgetBlocked: '0',
    pausedProviderUnavailable: '0',
    shardsFailed: '0',
    publicationsFailed: '0',
    publishConflicts: '0',
    staleCheckpoints: '0',
    retentionLag: '0',
    aiBatchBacklog: '0',
    tmHits: '0',
    tmMisses: '0',
    tmAverageSimilarity: null,
  };

  const tmHits = toNumber(row.tmHits);
  const tmMisses = toNumber(row.tmMisses);
  const tmAttempts = tmHits + tmMisses;
  const tmHitRatePercent = tmAttempts > 0 ? (tmHits / tmAttempts) * 100 : 0;
  const tmMissRatePercent = tmAttempts > 0 ? (tmMisses / tmAttempts) * 100 : 0;

  return {
    runsTotal: toNumber(row.runsTotal),
    termsTotal: toNumber(row.termsTotal),
    clustersTotal: toNumber(row.clustersTotal),
    glossaryTotal: toNumber(row.glossaryTotal),
    reviewPending: toNumber(row.reviewPending),
    reviewBacklog: toNumber(row.reviewBacklog),
    localizationsApproved: toNumber(row.localizationsApproved),
    publicationsPending: toNumber(row.publicationsPending),
    runsActive: toNumber(row.runsActive),
    runsPaused: toNumber(row.runsPaused),
    pausedBudgetBlocked: toNumber(row.pausedBudgetBlocked),
    pausedProviderUnavailable: toNumber(row.pausedProviderUnavailable),
    shardsFailed: toNumber(row.shardsFailed),
    publicationsFailed: toNumber(row.publicationsFailed),
    publishConflicts: toNumber(row.publishConflicts),
    staleCheckpoints: toNumber(row.staleCheckpoints),
    retentionLag: toNumber(row.retentionLag),
    aiBatchBacklog: toNumber(row.aiBatchBacklog),
    tmHits,
    tmMisses,
    tmHitRatePercent,
    tmMissRatePercent,
    tmAverageSimilarity: toOptionalFiniteNumber(row.tmAverageSimilarity),
  };
}

const LEX_METRICS_TTL_MS = 30_000;
const LEX_QUEUE_COUNTS_TTL_MS = 30_000;

interface MetricsCacheEntry {
  ts: number;
  data: Awaited<ReturnType<typeof collectLexBaseMetrics>>;
}

interface QueueCountsCacheEntry {
  ts: number;
  data: { queueName: string; counts: LexQueueCounts }[];
}

const metricsCache = new Map<string, MetricsCacheEntry>();
const queueCountsCache = new Map<string, QueueCountsCacheEntry>();

export async function collectLexMetrics(params: {
  shopId: string;
  env: AppEnv;
}): Promise<LexMetricsDto> {
  const now = Date.now();

  const cachedBase = metricsCache.get(params.shopId);
  let baseMetrics: Awaited<ReturnType<typeof collectLexBaseMetrics>>;
  if (cachedBase && now - cachedBase.ts < LEX_METRICS_TTL_MS) {
    baseMetrics = cachedBase.data;
  } else {
    baseMetrics = await withTenantContext(
      params.shopId,
      async (client) => await collectLexBaseMetrics(client, params.shopId)
    );
    metricsCache.set(params.shopId, { ts: now, data: baseMetrics });
  }

  const cachedQueues = queueCountsCache.get(params.shopId);
  let queueCounts: { queueName: string; counts: LexQueueCounts }[];
  if (cachedQueues && now - cachedQueues.ts < LEX_QUEUE_COUNTS_TTL_MS) {
    queueCounts = cachedQueues.data;
  } else {
    queueCounts = await Promise.all(
      LEX_QUEUE_NAMES.map(async (queueName) => ({
        queueName,
        counts: await getLexQueueCounts(params.env, queueName),
      }))
    );
    queueCountsCache.set(params.shopId, { ts: now, data: queueCounts });
  }

  const queueErrors = queueCounts
    .filter(
      ({ counts }) => typeof counts.errorMessage === 'string' && counts.errorMessage.length > 0
    )
    .map(({ queueName, counts }) => ({ queueName, message: counts.errorMessage ?? 'unknown' }));

  const queues: LexQueueHealthDto[] = queueCounts.map(({ queueName, counts }) => ({
    name: queueName,
    waiting: counts.waiting,
    active: counts.active,
    delayed: counts.delayed,
    failed: counts.failed,
    completed: counts.completed,
    dlqEntries: counts.dlqEntries,
    queueUrl: buildQueueUrl(queueName),
    dlqQueueName: toDlqQueueName(queueName),
    dlqUrl: buildQueueUrl(toDlqQueueName(queueName)),
  }));

  const dlqEntries = queues.reduce((sum, queue) => sum + queue.dlqEntries, 0);
  const { workers, workersOnline } = buildWorkerHealth();

  const metrics: LexMetricsDto = {
    ...baseMetrics,
    dlqEntries,
    workersOnline,
    workersTotal: workers.length,
    workers,
    queues,
    alerts: [],
  };

  metrics.alerts = buildHealthAlerts({
    metrics,
    queues,
    workers,
    queueErrors,
  });

  setLexMetricsSnapshot(params.shopId, {
    runsActive: metrics.runsActive,
    runsPaused: metrics.runsPaused,
    shardsFailed: metrics.shardsFailed,
    staleCheckpoints: metrics.staleCheckpoints,
    aiBatchBacklog: metrics.aiBatchBacklog,
    reviewBacklog: metrics.reviewBacklog,
    publicationsPending: metrics.publicationsPending,
    publicationsFailed: metrics.publicationsFailed,
    publishConflicts: metrics.publishConflicts,
    retentionLag: metrics.retentionLag,
    dlqEntries: metrics.dlqEntries,
  });

  return metrics;
}

export async function refreshLexMetrics(params: {
  shopId: string | null | undefined;
  env: AppEnv;
}): Promise<void> {
  const shopId = typeof params.shopId === 'string' ? params.shopId.trim() : '';
  if (!shopId) return;
  await collectLexMetrics({
    shopId,
    env: params.env,
  });
}

export type LexQualityCalibrationResult = Readonly<{
  averageQuality: number | null;
  sampleSize: number;
  recommendedAutoApproveThreshold: number;
  recommendedConsensusEscalation: number;
}>;

export async function calibrateLexQualityThresholds(params: {
  shopId: string;
}): Promise<LexQualityCalibrationResult> {
  return withTenantContext(params.shopId, async (client) => {
    const result = await client.query<{
      avgQuality: string | null;
      sampleSize: string;
    }>(
      `SELECT
         AVG(t.quality_score::double precision)::text AS "avgQuality",
         COUNT(*)::text AS "sampleSize"
       FROM lex_translations t
       WHERE t.shop_id = $1
         AND t.quality_score IS NOT NULL
         AND t.created_at >= (
           SELECT r.started_at
           FROM lex_runs r
           WHERE r.shop_id = $1
             AND r.status = 'completed'
           ORDER BY r.completed_at DESC
           LIMIT 1
         )`,
      [params.shopId]
    );

    const row = result.rows[0];
    const avgQuality = toOptionalFiniteNumber(row?.avgQuality);
    const sampleSize = toNumber(row?.sampleSize);

    let recommendedAutoApproveThreshold: number;
    let recommendedConsensusEscalation: number;

    if (avgQuality !== null && avgQuality >= 0.85) {
      recommendedAutoApproveThreshold = 0.9;
      recommendedConsensusEscalation = 0.7;
    } else if (avgQuality !== null && avgQuality >= 0.75) {
      recommendedAutoApproveThreshold = 0.85;
      recommendedConsensusEscalation = 0.65;
    } else {
      recommendedAutoApproveThreshold = 0.95;
      recommendedConsensusEscalation = 0.8;
    }

    return {
      averageQuality: avgQuality,
      sampleSize,
      recommendedAutoApproveThreshold,
      recommendedConsensusEscalation,
    };
  });
}
