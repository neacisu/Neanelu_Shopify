import { withTenantContext } from '@app/database';
import { loadEnv } from '@app/config';

export async function trackEmbeddingCost(params: {
  shopId: string;
  tokensUsed: number;
  itemCount: number;
  model: string;
}): Promise<void> {
  if (!params.itemCount) return;
  const env = loadEnv();
  const estimatedCost =
    (Math.max(0, params.tokensUsed) / 1_000_000) * env.openAiEmbeddingCostPer1MTokens;
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
       VALUES ('openai', 'embeddings', $1, $2, $3, $4, $5, now())`,
      [
        params.itemCount,
        params.tokensUsed,
        estimatedCost,
        params.shopId,
        JSON.stringify({
          model: params.model,
          costPer1MTokens: env.openAiEmbeddingCostPer1MTokens,
        }),
      ]
    );
  });
}

export async function getDailyEmbeddingBudget(params: {
  shopId: string;
  dailyLimit: number;
}): Promise<{
  used: number;
  remaining: number;
  limit: number;
  usedCost: number;
  remainingCost: number;
  costLimit: number;
}> {
  const result = await withTenantContext(params.shopId, async (client) => {
    const [usageRes, settingsRes] = await Promise.all([
      client.query<{ used: number; used_cost: string }>(
        `SELECT
            COALESCE(SUM(request_count), 0) as "used",
            COALESCE(SUM(estimated_cost), 0) as used_cost
           FROM api_usage_log
          WHERE shop_id = $1
            AND api_provider = 'openai'
            AND endpoint = 'embeddings'
            AND created_at >= date_trunc('day', now())
            AND created_at < date_trunc('day', now()) + interval '1 day'`,
        [params.shopId]
      ),
      client.query<{ openai_daily_budget: string | null }>(
        `SELECT openai_daily_budget
           FROM shop_ai_credentials
          WHERE shop_id = $1`,
        [params.shopId]
      ),
    ]);
    return {
      used: Number(usageRes.rows[0]?.used ?? 0),
      usedCost: Number(usageRes.rows[0]?.used_cost ?? 0),
      costLimit: Number(settingsRes.rows[0]?.openai_daily_budget ?? 10),
    };
  });

  const remaining = Math.max(0, params.dailyLimit - result.used);
  const remainingCost = Math.max(0, result.costLimit - result.usedCost);
  return {
    used: result.used,
    remaining,
    limit: params.dailyLimit,
    usedCost: result.usedCost,
    remainingCost,
    costLimit: result.costLimit,
  };
}
