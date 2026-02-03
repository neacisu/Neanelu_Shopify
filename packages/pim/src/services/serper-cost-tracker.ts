import { getDbPool } from '../db.js';

const SERPER_COST_PER_REQUEST = 0.001;

export type BudgetStatus = Readonly<{
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  exceeded: boolean;
  alertTriggered: boolean;
}>;

export type TrackSerperCostParams = Readonly<{
  endpoint: string;
  httpStatus: number;
  responseTimeMs: number;
  productId?: string;
  jobId?: string;
  errorMessage?: string;
}>;

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export async function trackSerperCost(params: TrackSerperCostParams): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO api_usage_log (
       api_provider,
       endpoint,
       request_count,
       estimated_cost,
       http_status,
       response_time_ms,
       job_id,
       product_id,
       error_message,
       metadata,
       created_at
     )
     VALUES ('serper', $1, 1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [
      params.endpoint,
      SERPER_COST_PER_REQUEST,
      params.httpStatus,
      params.responseTimeMs,
      params.jobId ?? null,
      params.productId ?? null,
      params.errorMessage ?? null,
      JSON.stringify({}),
    ]
  );
}

export async function checkDailyBudget(): Promise<BudgetStatus> {
  const dailyLimit = Number(process.env['SERPER_DAILY_BUDGET'] ?? 1000);
  const alertThreshold = Number(process.env['SERPER_BUDGET_ALERT_THRESHOLD'] ?? 0.8);

  const pool = getDbPool();
  const result = await pool.query<{ used: string }>(
    `SELECT COALESCE(SUM(request_count), 0) as used
       FROM api_usage_log
      WHERE api_provider = 'serper'
        AND created_at >= date_trunc('day', now())
        AND created_at < date_trunc('day', now()) + interval '1 day'`
  );

  const used = Number(result.rows[0]?.used ?? 0);
  const remaining = Math.max(0, dailyLimit - used);
  const percentUsed = dailyLimit ? used / dailyLimit : 1;

  return {
    used,
    limit: dailyLimit,
    remaining,
    percentUsed,
    exceeded: used >= dailyLimit,
    alertTriggered: percentUsed >= alertThreshold,
  };
}

export async function getDailySerperUsage(): Promise<{
  requests: number;
  cost: number;
  percentUsed: number;
}> {
  const dailyLimit = Number(process.env['SERPER_DAILY_BUDGET'] ?? 1000);
  const pool = getDbPool();
  const result = await pool.query<{ requests: string; cost: string }>(
    `SELECT
        COALESCE(SUM(request_count), 0) as requests,
        COALESCE(SUM(estimated_cost), 0) as cost
       FROM api_usage_log
      WHERE api_provider = 'serper'
        AND created_at >= date_trunc('day', now())
        AND created_at < date_trunc('day', now()) + interval '1 day'`
  );
  const requests = Number(result.rows[0]?.requests ?? 0);
  const cost = Number(result.rows[0]?.cost ?? 0);
  const percentUsed = dailyLimit ? requests / dailyLimit : 1;
  return { requests, cost, percentUsed };
}
