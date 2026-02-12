import { getDbPool } from '../db.js';
import { loadEnv } from '@app/config';
import { COST_CONSTANTS, trackCost } from './cost-tracker.js';

const SERPER_COST_PER_REQUEST = COST_CONSTANTS.serper.costPerRequest;

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
  await trackCost({
    provider: 'serper',
    operation: 'search',
    endpoint: params.endpoint,
    requestCount: 1,
    estimatedCost: SERPER_COST_PER_REQUEST,
    httpStatus: params.httpStatus,
    responseTimeMs: params.responseTimeMs,
    ...(params.jobId ? { jobId: params.jobId } : {}),
    ...(params.productId ? { productId: params.productId } : {}),
    ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
  });
}

export async function checkDailyBudget(): Promise<BudgetStatus> {
  const env = loadEnv();
  const dailyLimit = env.serperDailyBudget;
  const alertThreshold = env.serperBudgetAlertThreshold;

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
  const env = loadEnv();
  const dailyLimit = env.serperDailyBudget;
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
