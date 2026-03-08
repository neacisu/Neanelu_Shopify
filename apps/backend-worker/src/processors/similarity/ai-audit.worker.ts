import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { withTenantContext } from '@app/database';
import { AIAuditorService } from '@app/pim';
import { resolveChatTaskCredentials } from '../../services/ai-provider-routing.js';
import { consensusChatCompletion } from '../../services/consensus-engine.js';
import { scanInput, scanOutput } from '../../services/guardrails.js';
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

export interface AIAuditWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
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

            const credentials = await resolveChatTaskCredentials({
              shopId: payload.shopId,
              taskType: 'audit',
              env,
              logger,
            });
            if (!credentials) {
              warnLogger(logger).warn(
                { shopId: payload.shopId },
                'No routed AI credentials available for AI audit'
              );
              return;
            }

            const data = await withTenantContext(payload.shopId, async (client) => {
              const result = await client.query<{
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
              }>(
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
              return;
            }

            const nowIso = new Date().toISOString();
            const matchDetails: Record<string, unknown> = {
              ai_audit_result: auditResult,
              ai_model_used: auditResult.modelUsed,
              ai_audit_completed_at: nowIso,
            };

            let confidence = 'pending';
            let rejectionReason: string | null = null;
            if (auditResult.decision === 'approve') {
              confidence = 'confirmed';
              await enqueueExtractionJobSafe({
                shopId: payload.shopId,
                matchId: payload.matchId,
              });
            } else if (auditResult.decision === 'reject') {
              confidence = 'rejected';
              rejectionReason = 'ai_audit_reject';
            } else {
              matchDetails['requires_human_review'] = true;
              matchDetails['human_review_reason'] = 'ai_audit_escalation';
            }

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
            });
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
