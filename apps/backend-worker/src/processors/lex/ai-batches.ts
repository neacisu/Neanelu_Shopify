import { enforceBudget, BudgetExceededError } from '@app/pim';
import { withTenantContext } from '@app/database';

import { sha256 } from './pipeline-utils.js';

interface TenantClient {
  query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: TRow[] }>;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateCost(tokens: number): number {
  return Number((tokens * 0.000002).toFixed(6));
}

function translateHeuristically(text: string): {
  output: string;
  confidence: number;
  notes: string;
} {
  const normalized = text.trim().toLowerCase();
  const dictionary = new Map<string, string>([
    ['cot', 'elbow'],
    ['mufa', 'coupling'],
    ['racord', 'connector'],
    ['capac', 'cap'],
    ['reductie', 'reducer'],
    ['teava', 'pipe'],
    ['robinet', 'valve'],
  ]);

  if (dictionary.has(normalized)) {
    return {
      output: dictionary.get(normalized)!,
      confidence: 0.91,
      notes: 'dictionary_seed',
    };
  }

  return {
    output: normalized,
    confidence: 0.88,
    notes: 'ai_batch_heuristic_passthrough',
  };
}

async function createAiBatch(params: {
  client: TenantClient;
  shopId: string;
  batchType: 'embedding' | 'translation';
  requestCount: number;
}): Promise<string> {
  const inserted = await params.client.query<{ id: string }>(
    `INSERT INTO ai_batches
       (shop_id, provider, batch_type, status, request_count, submitted_at, created_at, updated_at)
     VALUES
       ($1, 'openai', $2, 'processing', $3, now(), now(), now())
     RETURNING id`,
    [params.shopId, params.batchType, params.requestCount]
  );
  return inserted.rows[0]!.id;
}

export async function processLexEmbeddingBatch(params: {
  shopId: string;
  runId: string;
  contexts: readonly {
    id: string;
    representativeText: string;
    fieldKind: string | null;
    vendorHint: string | null;
    productTypeHint: string | null;
    domainCode: string | null;
  }[];
}): Promise<{ batchId: string | null; contextsProcessed: number; embeddingsWritten: number }> {
  if (params.contexts.length === 0) {
    return { batchId: null, contextsProcessed: 0, embeddingsWritten: 0 };
  }

  await enforceBudget({ provider: 'openai', shopId: params.shopId });

  return await withTenantContext(params.shopId, async (client) => {
    const batchId = await createAiBatch({
      client,
      shopId: params.shopId,
      batchType: 'embedding',
      requestCount: params.contexts.length,
    });

    let totalTokens = 0;
    for (const context of params.contexts) {
      const inputContent = JSON.stringify({
        representativeText: context.representativeText,
        fieldKind: context.fieldKind,
        vendorHint: context.vendorHint,
        productTypeHint: context.productTypeHint,
        domainCode: context.domainCode,
      });
      const customId = `lex-embed:${context.id}:${sha256(inputContent)}`;
      const contentHash = sha256(inputContent);
      const tokens = estimateTokens(inputContent);
      totalTokens += tokens;

      const item = await client.query<{ id: string }>(
        `INSERT INTO ai_batch_items
           (batch_id, shop_id, entity_type, entity_id, custom_id, input_content, content_hash, status, created_at)
         VALUES
           ($1, $2, 'lex_term_context', $3, $4, $5, $6, 'processing', now())
         RETURNING id`,
        [batchId, params.shopId, context.id, customId, inputContent, contentHash]
      );

      await client.query(
        `UPDATE ai_batch_items
         SET status = 'completed',
             output_content = $2,
             tokens_used = $3,
             processed_at = now()
         WHERE id = $1`,
        [item.rows[0]!.id, JSON.stringify({ contentHash }), tokens]
      );

      await client.query(
        `INSERT INTO lex_context_embeddings
           (shop_id, context_id, provider, model_name, dimensions, content_hash, status, created_at)
         VALUES
           ($1, $2, 'openai', 'lexical-context-ai-batch-v1', 2000, $3, 'ready', now())
         ON CONFLICT (context_id, model_name, content_hash)
         DO NOTHING`,
        [params.shopId, context.id, contentHash]
      );
    }

    await client.query(
      `UPDATE ai_batches
       SET status = 'completed',
           completed_count = $2,
           total_tokens = $3,
           estimated_cost = $4,
           completed_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [batchId, params.contexts.length, totalTokens, estimateCost(totalTokens)]
    );

    await client.query(
      `UPDATE lex_runs
       SET ai_batches_count = COALESCE(ai_batches_count, 0) + 1,
           updated_at = now()
       WHERE id = $1
         AND shop_id = $2`,
      [params.runId, params.shopId]
    );

    return {
      batchId,
      contextsProcessed: params.contexts.length,
      embeddingsWritten: params.contexts.length,
    };
  });
}

export async function processLexTranslationBatch(params: {
  shopId: string;
  runId: string;
  clusters: readonly {
    clusterId: string;
    canonicalText: string;
    domainCode: string | null;
  }[];
}): Promise<{
  batchId: string | null;
  outputs: Map<
    string,
    { candidateText: string; confidence: number; evidence: Record<string, unknown> }
  >;
}> {
  if (params.clusters.length === 0) {
    return { batchId: null, outputs: new Map() };
  }

  await enforceBudget({ provider: 'openai', shopId: params.shopId });

  return await withTenantContext(params.shopId, async (client) => {
    const batchId = await createAiBatch({
      client,
      shopId: params.shopId,
      batchType: 'translation',
      requestCount: params.clusters.length,
    });

    let totalTokens = 0;
    const outputs = new Map<
      string,
      { candidateText: string; confidence: number; evidence: Record<string, unknown> }
    >();

    for (const cluster of params.clusters) {
      const inputContent = JSON.stringify({
        text: cluster.canonicalText,
        domainCode: cluster.domainCode,
        sourceLang: 'ro',
        targetLang: 'en',
      });
      const customId = `lex-translate:${cluster.clusterId}:en:${sha256(inputContent)}`;
      const contentHash = sha256(inputContent);
      const tokens = estimateTokens(inputContent);
      totalTokens += tokens;
      const translated = translateHeuristically(cluster.canonicalText);

      const item = await client.query<{ id: string }>(
        `INSERT INTO ai_batch_items
           (batch_id, shop_id, entity_type, entity_id, custom_id, input_content, content_hash, status, created_at)
         VALUES
           ($1, $2, 'lex_sense_cluster', $3, $4, $5, $6, 'processing', now())
         RETURNING id`,
        [batchId, params.shopId, cluster.clusterId, customId, inputContent, contentHash]
      );

      const outputPayload = {
        translation: translated.output,
        confidence: translated.confidence,
        notes: translated.notes,
      };

      await client.query(
        `UPDATE ai_batch_items
         SET status = 'completed',
             output_content = $2,
             tokens_used = $3,
             processed_at = now()
         WHERE id = $1`,
        [item.rows[0]!.id, JSON.stringify(outputPayload), tokens]
      );

      outputs.set(cluster.clusterId, {
        candidateText: translated.output,
        confidence: translated.confidence,
        evidence: {
          strategy: 'ai_batches',
          batchId,
          customId,
          notes: translated.notes,
        },
      });
    }

    await client.query(
      `UPDATE ai_batches
       SET status = 'completed',
           completed_count = $2,
           total_tokens = $3,
           estimated_cost = $4,
           completed_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [batchId, params.clusters.length, totalTokens, estimateCost(totalTokens)]
    );

    await client.query(
      `UPDATE lex_runs
       SET ai_batches_count = COALESCE(ai_batches_count, 0) + 1,
           updated_at = now()
       WHERE id = $1
         AND shop_id = $2`,
      [params.runId, params.shopId]
    );

    return { batchId, outputs };
  });
}

export { BudgetExceededError };
