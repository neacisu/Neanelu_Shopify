import { getDbPool } from '../db.js';
import { COST_CONSTANTS, trackCost } from './cost-tracker.js';

const XAI_COST_PER_1M_INPUT = COST_CONSTANTS.xai.costPer1MInput;
const XAI_COST_PER_1M_OUTPUT = COST_CONSTANTS.xai.costPer1MOutput;

export type XaiBudgetStatus = Readonly<{
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  exceeded: boolean;
  alertTriggered: boolean;
}>;

export type TrackXaiCostParams = Readonly<{
  shopId?: string;
  endpoint: string;
  tokensInput: number;
  tokensOutput: number;
  httpStatus: number;
  responseTimeMs: number;
  productId?: string;
  matchId?: string;
  jobId?: string;
  errorMessage?: string;
}>;

export async function trackXaiCost(params: TrackXaiCostParams): Promise<void> {
  const estimatedCost =
    (params.tokensInput / 1_000_000) * XAI_COST_PER_1M_INPUT +
    (params.tokensOutput / 1_000_000) * XAI_COST_PER_1M_OUTPUT;

  await trackCost({
    provider: 'xai',
    operation: params.endpoint === 'ai-audit' ? 'audit' : 'extraction',
    endpoint: params.endpoint,
    requestCount: 1,
    tokensInput: params.tokensInput,
    tokensOutput: params.tokensOutput,
    estimatedCost,
    httpStatus: params.httpStatus,
    responseTimeMs: params.responseTimeMs,
    ...(params.jobId ? { jobId: params.jobId } : {}),
    ...(params.productId ? { productId: params.productId } : {}),
    ...(params.shopId ? { shopId: params.shopId } : {}),
    ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
    metadata: {
      ...(params.matchId ? { matchId: params.matchId } : {}),
    },
  });
}

export async function checkXaiDailyBudget(shopId: string): Promise<XaiBudgetStatus> {
  const pool = getDbPool();
  const budgetResult = await pool.query<{
    xai_daily_budget: number | null;
    xai_budget_alert_threshold: string | number | null;
  }>(
    `SELECT
       xai_daily_budget,
       xai_budget_alert_threshold
     FROM shop_ai_credentials
     WHERE shop_id = $1`,
    [shopId]
  );

  const limit = budgetResult.rows[0]?.xai_daily_budget ?? 1000;
  const alertThresholdRaw = budgetResult.rows[0]?.xai_budget_alert_threshold ?? 0.8;
  const alertThreshold =
    typeof alertThresholdRaw === 'number' ? alertThresholdRaw : Number(alertThresholdRaw);

  const usageResult = await pool.query<{ cost: string }>(
    `SELECT COALESCE(SUM(estimated_cost), 0) as cost
       FROM api_usage_log
      WHERE api_provider = 'xai'
        AND shop_id = $1
        AND created_at >= date_trunc('day', now())
        AND created_at < date_trunc('day', now()) + interval '1 day'`,
    [shopId]
  );

  const used = Number(usageResult.rows[0]?.cost ?? 0);
  const remaining = Math.max(0, limit - used);
  const percentUsed = limit ? used / limit : 1;

  return {
    used,
    limit,
    remaining,
    percentUsed,
    exceeded: used >= limit,
    alertTriggered: percentUsed >= (Number.isFinite(alertThreshold) ? alertThreshold : 0.8),
  };
}
