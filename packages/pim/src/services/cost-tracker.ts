import { getDbPool } from '../db.js';

export const COST_CONSTANTS = {
  serper: { costPerRequest: 0.001 },
  xai: { costPer1MInput: 0.2, costPer1MOutput: 0.5 },
  openai: { costPer1MTokens: 0.02 },
} as const;

export type ApiProvider = 'serper' | 'xai' | 'openai';
export type CostOperation = 'search' | 'audit' | 'extraction' | 'embedding' | 'other';

export type TrackCostParams = Readonly<{
  provider: ApiProvider;
  operation: CostOperation;
  endpoint: string;
  shopId?: string;
  requestCount?: number;
  tokensInput?: number;
  tokensOutput?: number;
  estimatedCost: number;
  httpStatus: number;
  responseTimeMs: number;
  productId?: string;
  jobId?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}>;

export type UnifiedBudgetStatus = Readonly<{
  provider: ApiProvider;
  primary: {
    unit: 'requests' | 'dollars' | 'items';
    used: number;
    limit: number;
    remaining: number;
    ratio: number;
  };
  secondary?: {
    unit: 'items';
    used: number;
    limit: number;
    remaining: number;
    ratio: number;
  };
  alertThreshold: number;
  exceeded: boolean;
  alertTriggered: boolean;
}>;

type OTelUsageCallback = (params: {
  provider: ApiProvider;
  operation: CostOperation;
  estimatedCost: number;
  requestCount: number;
  tokensTotal: number;
  responseTimeMs: number;
  isError: boolean;
}) => void;

let otelUsageCallback: OTelUsageCallback | null = null;

export function registerOtelCallback(callback: OTelUsageCallback | null): void {
  otelUsageCallback = callback;
}

export async function trackCost(params: TrackCostParams): Promise<void> {
  const pool = getDbPool();
  const tokensInput = params.tokensInput ?? 0;
  const tokensOutput = params.tokensOutput ?? 0;
  const requestCount = params.requestCount ?? 1;

  await pool.query(
    `INSERT INTO api_usage_log (
       api_provider,
       endpoint,
       request_count,
       tokens_input,
       tokens_output,
       estimated_cost,
       http_status,
       response_time_ms,
       job_id,
       product_id,
       shop_id,
       error_message,
       metadata,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
    [
      params.provider,
      params.endpoint,
      requestCount,
      tokensInput || null,
      tokensOutput || null,
      params.estimatedCost,
      params.httpStatus,
      params.responseTimeMs,
      params.jobId ?? null,
      params.productId ?? null,
      params.shopId ?? null,
      params.errorMessage ?? null,
      JSON.stringify({ ...(params.metadata ?? {}), operation: params.operation }),
    ]
  );

  otelUsageCallback?.({
    provider: params.provider,
    operation: params.operation,
    estimatedCost: params.estimatedCost,
    requestCount,
    tokensTotal: tokensInput + tokensOutput,
    responseTimeMs: params.responseTimeMs,
    isError: params.httpStatus >= 400,
  });
}

export async function checkBudget(
  provider: ApiProvider,
  shopId: string
): Promise<UnifiedBudgetStatus> {
  const pool = getDbPool();

  if (provider === 'serper') {
    const [budgetRes, usageRes] = await Promise.all([
      pool.query<{
        serper_daily_budget: number | null;
        serper_budget_alert_threshold: string | null;
      }>(
        `SELECT serper_daily_budget, serper_budget_alert_threshold
           FROM shop_ai_credentials
          WHERE shop_id = $1`,
        [shopId]
      ),
      pool.query<{ used: string }>(
        `SELECT COALESCE(SUM(request_count), 0) as used
           FROM api_usage_log
          WHERE api_provider = 'serper'
            AND shop_id = $1
            AND created_at >= date_trunc('day', now())
            AND created_at < date_trunc('day', now()) + interval '1 day'`,
        [shopId]
      ),
    ]);

    const limit = Number(budgetRes.rows[0]?.serper_daily_budget ?? 1000);
    const alertThreshold = Number(budgetRes.rows[0]?.serper_budget_alert_threshold ?? 0.8);
    const used = Number(usageRes.rows[0]?.used ?? 0);
    const ratio = limit > 0 ? used / limit : 1;

    return {
      provider,
      primary: {
        unit: 'requests',
        used,
        limit,
        remaining: Math.max(0, limit - used),
        ratio,
      },
      alertThreshold,
      exceeded: used >= limit,
      alertTriggered: ratio >= alertThreshold,
    };
  }

  if (provider === 'xai') {
    const [budgetRes, usageRes] = await Promise.all([
      pool.query<{ xai_daily_budget: number | null; xai_budget_alert_threshold: string | null }>(
        `SELECT xai_daily_budget, xai_budget_alert_threshold
           FROM shop_ai_credentials
          WHERE shop_id = $1`,
        [shopId]
      ),
      pool.query<{ used: string }>(
        `SELECT COALESCE(SUM(estimated_cost), 0) as used
           FROM api_usage_log
          WHERE api_provider = 'xai'
            AND shop_id = $1
            AND created_at >= date_trunc('day', now())
            AND created_at < date_trunc('day', now()) + interval '1 day'`,
        [shopId]
      ),
    ]);

    const limit = Number(budgetRes.rows[0]?.xai_daily_budget ?? 1000);
    const alertThreshold = Number(budgetRes.rows[0]?.xai_budget_alert_threshold ?? 0.8);
    const used = Number(usageRes.rows[0]?.used ?? 0);
    const ratio = limit > 0 ? used / limit : 1;

    return {
      provider,
      primary: {
        unit: 'dollars',
        used,
        limit,
        remaining: Math.max(0, limit - used),
        ratio,
      },
      alertThreshold,
      exceeded: used >= limit,
      alertTriggered: ratio >= alertThreshold,
    };
  }

  const [budgetRes, usageRes] = await Promise.all([
    pool.query<{
      openai_daily_budget: string | null;
      openai_budget_alert_threshold: string | null;
      openai_items_daily_budget: number | null;
    }>(
      `SELECT openai_daily_budget, openai_budget_alert_threshold, openai_items_daily_budget
         FROM shop_ai_credentials
        WHERE shop_id = $1`,
      [shopId]
    ),
    pool.query<{ used_cost: string; used_items: string }>(
      `SELECT
          COALESCE(SUM(estimated_cost), 0) as used_cost,
          COALESCE(SUM(request_count), 0) as used_items
         FROM api_usage_log
        WHERE api_provider = 'openai'
          AND shop_id = $1
          AND created_at >= date_trunc('day', now())
          AND created_at < date_trunc('day', now()) + interval '1 day'`,
      [shopId]
    ),
  ]);

  const costLimit = Number(budgetRes.rows[0]?.openai_daily_budget ?? 10);
  const itemsLimit = Number(budgetRes.rows[0]?.openai_items_daily_budget ?? 100000);
  const alertThreshold = Number(budgetRes.rows[0]?.openai_budget_alert_threshold ?? 0.8);
  const usedCost = Number(usageRes.rows[0]?.used_cost ?? 0);
  const usedItems = Number(usageRes.rows[0]?.used_items ?? 0);
  const costRatio = costLimit > 0 ? usedCost / costLimit : 1;
  const itemsRatio = itemsLimit > 0 ? usedItems / itemsLimit : 1;
  const ratio = Math.max(costRatio, itemsRatio);

  return {
    provider,
    primary: {
      unit: 'dollars',
      used: usedCost,
      limit: costLimit,
      remaining: Math.max(0, costLimit - usedCost),
      ratio: costRatio,
    },
    secondary: {
      unit: 'items',
      used: usedItems,
      limit: itemsLimit,
      remaining: Math.max(0, itemsLimit - usedItems),
      ratio: itemsRatio,
    },
    alertThreshold,
    exceeded: usedCost >= costLimit || usedItems >= itemsLimit,
    alertTriggered: ratio >= alertThreshold,
  };
}

export async function checkAllBudgets(shopId: string): Promise<UnifiedBudgetStatus[]> {
  const providers: readonly ApiProvider[] = ['serper', 'xai', 'openai'];
  return Promise.all(providers.map((provider) => checkBudget(provider, shopId)));
}

export async function getMaxBudgetRatios(): Promise<
  readonly { provider: ApiProvider; maxRatio: number }[]
> {
  const pool = getDbPool();
  const result = await pool.query<{
    serper_max: string | null;
    xai_max: string | null;
    openai_cost_max: string | null;
    openai_items_max: string | null;
  }>(
    `SELECT
        MAX(serper_ratio) as serper_max,
        MAX(xai_ratio) as xai_max,
        MAX(openai_cost_ratio) as openai_cost_max,
        MAX(openai_items_ratio) as openai_items_max
       FROM v_api_budget_status`
  );

  const row = result.rows[0];
  const openAiCostRatio = Number(row?.openai_cost_max ?? 0);
  const openAiItemsRatio = Number(row?.openai_items_max ?? 0);

  return [
    { provider: 'serper', maxRatio: Number(row?.serper_max ?? 0) },
    { provider: 'xai', maxRatio: Number(row?.xai_max ?? 0) },
    { provider: 'openai', maxRatio: Math.max(openAiCostRatio, openAiItemsRatio) },
  ];
}
