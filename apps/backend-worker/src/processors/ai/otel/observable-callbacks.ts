import { pool } from '@app/database';

import { setAiBacklogItems, setAiBatchAgeSeconds } from '../../../otel/metrics.js';

type MetricUpdateResult = Readonly<{
  backlogItems: number;
  batchAgeSeconds: number;
}>;

async function queryAiBacklog(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM shop_product_embeddings
      WHERE status IN ('pending', 'processing')`
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function queryOldestBatchAgeSeconds(): Promise<number> {
  const result = await pool.query<{ age_seconds: number | null }>(
    `SELECT EXTRACT(EPOCH FROM (now() - MIN(submitted_at))) AS age_seconds
       FROM embedding_batches
      WHERE status IN ('submitted', 'processing')
        AND submitted_at IS NOT NULL`
  );
  const ageSeconds = result.rows[0]?.age_seconds ?? 0;
  return Number.isFinite(ageSeconds) ? Math.max(0, ageSeconds) : 0;
}

export async function refreshAiObservabilityMetrics(): Promise<MetricUpdateResult> {
  const [backlogItems, batchAgeSeconds] = await Promise.all([
    queryAiBacklog(),
    queryOldestBatchAgeSeconds(),
  ]);

  setAiBacklogItems(backlogItems);
  setAiBatchAgeSeconds(batchAgeSeconds);

  return { backlogItems, batchAgeSeconds };
}
