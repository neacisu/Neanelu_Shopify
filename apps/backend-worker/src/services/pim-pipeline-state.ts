import type { Logger } from '@app/logger';
import { enqueueConsensusJob } from '../queue/consensus-queue.js';

type DbClient = Readonly<{
  query: <T = unknown>(sql: string, values?: readonly unknown[]) => Promise<{ rows: T[] }>;
}>;

export type PipelineSettlementTrigger =
  | 'similarity_complete'
  | 'ai_audit_complete'
  | 'extraction_complete'
  | 'extraction_failed';

export type SimilarityPipelineState = Readonly<{
  pendingAiAuditCount: number;
  pendingExtractionCount: number;
  confirmedExtractedCount: number;
  humanReviewCount: number;
}>;

export async function getSimilarityPipelineState(params: {
  client: DbClient;
  productId: string;
}): Promise<SimilarityPipelineState> {
  const result = await params.client.query<{
    pending_ai_audit_count: string | number | null;
    pending_extraction_count: string | number | null;
    confirmed_extracted_count: string | number | null;
    human_review_count: string | number | null;
  }>(
    `SELECT
       COUNT(*) FILTER (
         WHERE match_confidence = 'pending'
           AND (match_details ->> 'triage_decision') = 'ai_audit'
       )::bigint AS pending_ai_audit_count,
       COUNT(*) FILTER (
         WHERE match_confidence = 'confirmed'
           AND specs_extracted IS NULL
           AND COALESCE(match_details ->> 'extraction_status', 'pending') NOT IN ('failed', 'blocked')
       )::bigint AS pending_extraction_count,
       COUNT(*) FILTER (
         WHERE match_confidence = 'confirmed'
           AND specs_extracted IS NOT NULL
       )::bigint AS confirmed_extracted_count,
       COUNT(*) FILTER (
         WHERE (match_details ->> 'requires_human_review') = 'true'
       )::bigint AS human_review_count
     FROM prod_similarity_matches
     WHERE product_id = $1`,
    [params.productId]
  );

  const row = result.rows[0];
  return {
    pendingAiAuditCount: Number(row?.pending_ai_audit_count ?? 0),
    pendingExtractionCount: Number(row?.pending_extraction_count ?? 0),
    confirmedExtractedCount: Number(row?.confirmed_extracted_count ?? 0),
    humanReviewCount: Number(row?.human_review_count ?? 0),
  };
}

export async function maybeEnqueueConsensusAfterAutomation(params: {
  client: DbClient;
  shopId: string;
  productId: string;
  trigger: PipelineSettlementTrigger;
  logger: Logger;
  context: string;
}): Promise<string | null> {
  const state = await getSimilarityPipelineState({
    client: params.client,
    productId: params.productId,
  });

  if (state.pendingAiAuditCount > 0 || state.pendingExtractionCount > 0) {
    params.logger.info(
      {
        shopId: params.shopId,
        productId: params.productId,
        trigger: params.trigger,
        context: params.context,
        ...state,
      },
      'pim_pipeline_consensus_deferred'
    );
    return null;
  }

  const jobId = await enqueueConsensusJob({
    shopId: params.shopId,
    productId: params.productId,
    trigger: params.trigger,
  });
  const normalizedJobId = jobId != null ? String(jobId) : null;
  params.logger.info(
    {
      shopId: params.shopId,
      productId: params.productId,
      trigger: params.trigger,
      context: params.context,
      consensusJobId: normalizedJobId,
      ...state,
    },
    'pim_pipeline_consensus_enqueued'
  );
  return normalizedJobId;
}
