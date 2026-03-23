import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { withTenantContext } from '@app/database';
import { AIAuditorService } from '@app/pim';
import { resolveChatTaskCredentials } from '../../services/ai-provider-routing.js';
import { consensusChatCompletion } from '../../services/consensus-engine.js';
import { scanInput, scanOutput } from '../../services/guardrails.js';
import { maybeEnqueueConsensusAfterAutomation } from '../../services/pim-pipeline-state.js';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { enqueueExtractionJob } from '../../queue/similarity-queues.js';

const warnLogger = (logger: Logger) =>
  logger as Logger & {
    warn: (data: Record<string, unknown>, message: string) => void;
  };

const enqueueExtractionJobSafe = enqueueExtractionJob as (params: {
  shopId: string;
  matchId: string;
}) => Promise<unknown>;

export const AI_AUDIT_QUEUE_NAME = 'pim-ai-audit';
export const AI_AUDIT_JOB = 'audit-single';

type AIAuditJobPayload = Readonly<{
  shopId: string;
  matchId: string;
}>;

type MatchAuditContext = Readonly<{
  match_id: string;
  similarity_score: string;
  source_url: string;
  source_title: string | null;
  source_brand: string | null;
  source_gtin: string | null;
  source_price: string | null;
  source_currency: string | null;
  product_id: string;
  title: string;
  brand: string | null;
  gtin: string | null;
  mpn: string | null;
}>;

function isFinalJobAttempt(
  job: { attemptsMade?: number; opts?: { attempts?: number } } | null
): boolean {
  const configuredAttempts =
    typeof job?.opts?.attempts === 'number' && job.opts.attempts > 0 ? job.opts.attempts : 1;
  const currentAttempt = typeof job?.attemptsMade === 'number' ? job.attemptsMade + 1 : 1;
  return currentAttempt >= configuredAttempts;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function handleAuditFailure(
  error: unknown,
  payload: AIAuditJobPayload,
  data: MatchAuditContext | null,
  isFinal: boolean,
  logger: Logger
): Promise<void> {
  if (!isFinal || !data?.product_id) return;
  const errMsg = toErrorMessage(error);
  logger.error(
    {
      shopId: payload.shopId,
      matchId: payload.matchId,
      productId: data.product_id,
      error: errMsg,
    },
    'ai_audit_failed_final_attempt'
  );
  await markMatchForHumanReview({
    shopId: payload.shopId,
    matchId: payload.matchId,
    productId: data.product_id,
    logger,
    reason: 'ai_audit_failed_final_attempt',
    extraDetails: { ai_audit_error: errMsg },
  });
}

export interface AIAuditWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

async function markMatchForHumanReview(params: {
  shopId: string;
  matchId: string;
  productId: string;
  logger: Logger;
  reason: string;
  extraDetails?: Record<string, unknown>;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE prod_similarity_matches
          SET match_confidence = 'uncertain',
              rejection_reason = NULL,
              verified_at = now(),
              match_details = COALESCE(match_details, '{}'::jsonb) || $1::jsonb,
              updated_at = now()
        WHERE id = $2`,
      [
        JSON.stringify({
          requires_human_review: true,
          human_review_reason: params.reason,
          human_review_marked_at: nowIso,
          ai_audit_status: 'blocked',
          ...params.extraDetails,
        }),
        params.matchId,
      ]
    );
    await maybeEnqueueConsensusAfterAutomation({
      client,
      shopId: params.shopId,
      productId: params.productId,
      trigger: 'ai_audit_complete',
      logger: params.logger,
      context: params.reason,
    });
  });
}

async function executeAudit(
  payload: AIAuditJobPayload,
  env: ReturnType<typeof loadEnv>,
  logger: Logger,
  isFinal: boolean
): Promise<void> {
  let data: MatchAuditContext | null = null;
  try {
    data = await withTenantContext(payload.shopId, async (client) => {
      const result = await client.query<MatchAuditContext>(
        `SELECT m.id as match_id,
                m.similarity_score,
                m.source_url,
                m.source_title,
                m.source_brand,
                m.source_gtin,
                m.source_price,
                m.source_currency,
                m.product_id,
                sp.title,
                pm.brand,
                pm.gtin,
                pm.mpn
           FROM prod_similarity_matches m
           JOIN prod_channel_mappings pcm
             ON pcm.product_id = m.product_id
            AND pcm.channel = 'shopify'
            AND pcm.shop_id = $1
           JOIN shopify_products sp
             ON sp.shopify_gid = pcm.external_id
            AND sp.shop_id = $1
           JOIN prod_master pm
             ON pm.id = m.product_id
          WHERE m.id = $2`,
        [payload.shopId, payload.matchId]
      );
      return result.rows[0] ?? null;
    });

    if (!data) {
      warnLogger(logger).warn({ matchId: payload.matchId }, 'AI audit match not found');
      return;
    }

    const credentials = await resolveChatTaskCredentials({
      shopId: payload.shopId,
      taskType: 'audit',
      env,
      logger,
    });
    if (!credentials) {
      warnLogger(logger).warn(
        { shopId: payload.shopId, matchId: payload.matchId },
        'No routed AI credentials available for AI audit'
      );
      await markMatchForHumanReview({
        shopId: payload.shopId,
        matchId: payload.matchId,
        productId: data.product_id,
        logger,
        reason: 'ai_audit_credentials_unavailable',
      });
      return;
    }

    const auditInputPayload = {
      localProduct: {
        title: data.title,
        brand: data.brand,
        gtin: data.gtin,
        mpn: data.mpn,
      },
      match: {
        similarityScore: Number(data.similarity_score),
        sourceUrl: data.source_url,
        sourceTitle: data.source_title,
        sourceBrand: data.source_brand,
        sourceGtin: data.source_gtin,
        sourcePrice: data.source_price,
        sourceCurrency: data.source_currency,
      },
    };
    const inputScan = await scanInput({
      shopId: payload.shopId,
      text: JSON.stringify(auditInputPayload),
      env,
      logger,
    });
    if (!inputScan.isValid) {
      warnLogger(logger).warn(
        { shopId: payload.shopId, matchId: payload.matchId, reason: inputScan.reason },
        'guardrails_blocked_ai_audit_input'
      );
      await markMatchForHumanReview({
        shopId: payload.shopId,
        matchId: payload.matchId,
        productId: data.product_id,
        logger,
        reason: 'guardrails_blocked_ai_audit_input',
        extraDetails: { ai_audit_guardrails_reason: inputScan.reason },
      });
      return;
    }

    const auditor = new AIAuditorService();
    const auditResult = await auditor.auditMatch({
      shopId: payload.shopId,
      credentials,
      completionRunner: async ({ systemPrompt, userPrompt }) => {
        const consensus = await consensusChatCompletion<Record<string, unknown>>({
          shopId: payload.shopId,
          env,
          logger,
          taskType: 'audit',
          systemPrompt,
          userPrompt,
          responseFormat: { type: 'json_object' },
          keyField: 'recommendation',
          maxTokens: Math.max(300, Math.min(credentials.maxTokensPerRequest, 1200)),
        });
        return {
          content: JSON.stringify(consensus.result),
          httpStatus: 200,
          tokensInput: 0,
          tokensOutput: 0,
          modelUsed: consensus.models.join(', '),
          providerUsed: credentials.provider,
        };
      },
      localProduct: {
        title: data.title,
        brand: data.brand,
        gtin: data.gtin,
        mpn: data.mpn,
      },
      match: {
        similarityScore: Number(data.similarity_score),
        sourceUrl: data.source_url,
        sourceTitle: data.source_title,
        sourceBrand: data.source_brand,
        sourceGtin: data.source_gtin,
        sourcePrice: data.source_price,
        sourceCurrency: data.source_currency,
      },
    });
    const outputScan = await scanOutput({
      shopId: payload.shopId,
      prompt: inputScan.sanitizedText,
      output: JSON.stringify(auditResult),
      env,
      logger,
    });
    if (!outputScan.isValid) {
      warnLogger(logger).warn(
        { shopId: payload.shopId, matchId: payload.matchId, reason: outputScan.reason },
        'guardrails_blocked_ai_audit_output'
      );
      await markMatchForHumanReview({
        shopId: payload.shopId,
        matchId: payload.matchId,
        productId: data.product_id,
        logger,
        reason: 'guardrails_blocked_ai_audit_output',
        extraDetails: { ai_audit_guardrails_reason: outputScan.reason },
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const matchDetails: Record<string, unknown> = {
      ai_audit_result: auditResult,
      ai_model_used: auditResult.modelUsed,
      ai_audit_completed_at: nowIso,
      ai_audit_status: auditResult.decision,
    };

    let confidence: 'confirmed' | 'rejected' | 'uncertain' = 'uncertain';
    let rejectionReason: string | null = null;
    if (auditResult.decision === 'approve') {
      await enqueueExtractionJobSafe({
        shopId: payload.shopId,
        matchId: payload.matchId,
      });
      confidence = 'confirmed';
      matchDetails['extraction_status'] = 'queued';
      matchDetails['extraction_queued_at'] = nowIso;
    } else if (auditResult.decision === 'reject') {
      confidence = 'rejected';
      rejectionReason = 'ai_audit_reject';
    } else {
      matchDetails['requires_human_review'] = true;
      matchDetails['human_review_reason'] = 'ai_audit_escalation';
      matchDetails['human_review_marked_at'] = nowIso;
    }

    const productId = data.product_id;
    await withTenantContext(payload.shopId, async (client) => {
      await client.query(
        `UPDATE prod_similarity_matches
            SET match_confidence = $1,
                rejection_reason = $2,
                verified_at = now(),
                match_details = COALESCE(match_details, '{}'::jsonb) || $3::jsonb,
                updated_at = now()
          WHERE id = $4`,
        [confidence, rejectionReason, JSON.stringify(matchDetails), payload.matchId]
      );
      await maybeEnqueueConsensusAfterAutomation({
        client,
        shopId: payload.shopId,
        productId,
        trigger: 'ai_audit_complete',
        logger,
        context: `ai_audit_${auditResult.decision}`,
      });
    });
  } catch (error) {
    await handleAuditFailure(error, payload, data, isFinal, logger);
    throw error;
  }
}

export function startAIAuditWorker(logger: Logger): AIAuditWorkerHandle {
  const env = loadEnv();
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: AI_AUDIT_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('ai-audit-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });

          try {
            if (job.name !== AI_AUDIT_JOB) {
              throw new Error(`unknown_ai_audit_job:${job.name}`);
            }

            const payload = job.data as AIAuditJobPayload | null;
            if (!payload?.shopId || !payload.matchId) {
              throw new Error('invalid_ai_audit_payload');
            }

            await executeAudit(payload, env, logger, isFinalJobAttempt(job));
          } finally {
            clearWorkerCurrentJob('ai-audit-worker', jobId);
          }
        }),
    }
  );

  return {
    worker,
    close: async () => {
      await worker.close();
    },
  };
}
