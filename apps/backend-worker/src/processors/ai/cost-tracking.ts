import { withTenantContext } from '@app/database';

export async function trackEmbeddingCost(params: {
  shopId: string;
  tokensUsed: number;
  itemCount: number;
  model: string;
}): Promise<void> {
  if (!params.itemCount) return;
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `INSERT INTO api_usage_log (
         api_provider,
         endpoint,
         request_count,
         tokens_input,
         estimated_cost,
         shop_id,
         metadata,
         created_at
       )
       VALUES ('openai', 'embeddings', $1, $2, NULL, $3, $4, now())`,
      [params.itemCount, params.tokensUsed, params.shopId, JSON.stringify({ model: params.model })]
    );
  });
}

export async function getDailyEmbeddingBudget(params: {
  shopId: string;
  dailyLimit: number;
}): Promise<{ used: number; remaining: number; limit: number }> {
  const used = await withTenantContext(params.shopId, async (client) => {
    const res = await client.query<{ used: number }>(
      `SELECT COALESCE(SUM(request_count), 0) as "used"
         FROM api_usage_log
        WHERE shop_id = $1
          AND api_provider = 'openai'
          AND endpoint = 'embeddings'
          AND created_at >= date_trunc('day', now())
          AND created_at < date_trunc('day', now()) + interval '1 day'`,
      [params.shopId]
    );
    return Number(res.rows[0]?.used ?? 0);
  });

  const remaining = Math.max(0, params.dailyLimit - used);
  return { used, remaining, limit: params.dailyLimit };
}
