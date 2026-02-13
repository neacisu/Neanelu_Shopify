import { createHmac } from 'node:crypto';
import type { Logger } from '@app/logger';
import { pool } from '@app/database';
import { loadEnv } from '@app/config';
import {
  configFromEnv,
  createQueue,
  createWorker,
  withJobTelemetryContext,
} from '@app/queue-manager';

export const WEEKLY_SUMMARY_QUEUE_NAME = 'pim-weekly-summary-queue';
export const WEEKLY_SUMMARY_JOB_NAME = 'pim.weekly.cost-summary';

export interface WeeklySummaryWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  queue: { close: () => Promise<void> };
  close: () => Promise<void>;
}

type ApiUsageSummaryRow = Readonly<{
  provider: string;
  total_cost: string;
  total_requests: string;
}>;

type WeeklyProviderStats = Readonly<{
  cost: number;
  requests: number;
}>;

type WeeklySummaryPayload = Readonly<{
  shopId: string;
  totalCost: number;
  providers: Record<string, WeeklyProviderStats>;
  period: 'previous_week';
}>;

function computeSignature(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function dispatchWeeklySummaryWebhook(params: {
  url: string;
  payload: WeeklySummaryPayload;
  secret?: string;
  maxAttempts?: number;
}): Promise<void> {
  const body = JSON.stringify(params.payload);
  const maxAttempts = params.maxAttempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const timestamp = String(Date.now());
      const signature = params.secret
        ? computeSignature(params.secret, timestamp, body)
        : undefined;
      const response = await fetch(params.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Neanelu-Event': 'weekly_cost_summary',
          'X-Neanelu-Timestamp': timestamp,
          ...(signature ? { 'X-Neanelu-Signature': signature } : {}),
        },
        body,
      });
      if (!response.ok) {
        throw new Error(`Weekly summary webhook failed with status ${response.status}`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      const delayMs = 1000 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Weekly summary webhook dispatch failed');
}

export async function runWeeklySummaryTick(logger: Logger): Promise<number> {
  const shopsResult = await pool.query<{ id: string }>(`SELECT id FROM shops`);

  for (const shop of shopsResult.rows) {
    const summaryResult = await pool.query<ApiUsageSummaryRow>(
      `SELECT
          api_provider as provider,
          COALESCE(SUM(estimated_cost), 0) as total_cost,
          COALESCE(SUM(request_count), 0) as total_requests
         FROM api_usage_log
        WHERE shop_id = $1
          AND created_at >= date_trunc('week', now()) - interval '7 days'
          AND created_at < date_trunc('week', now())
        GROUP BY api_provider`,
      [shop.id]
    );

    const byProvider: Record<string, WeeklyProviderStats> = {};
    let totalCost = 0;
    for (const row of summaryResult.rows) {
      const cost = Number(row.total_cost ?? 0);
      const requests = Number(row.total_requests ?? 0);
      byProvider[row.provider] = { cost, requests };
      totalCost += cost;
    }

    const payload: WeeklySummaryPayload = {
      shopId: shop.id,
      totalCost,
      providers: byProvider,
      period: 'previous_week',
    };

    await pool.query(
      `INSERT INTO pim_notifications (
         shop_id, type, title, body, read, created_at
       )
       VALUES ($1, 'weekly_cost_summary', $2, $3::jsonb, false, now())`,
      [shop.id, 'Weekly API cost summary', JSON.stringify(payload)]
    );

    const webhookUrl = process.env['PIM_WEEKLY_SUMMARY_WEBHOOK_URL'];
    const webhookSecret = process.env['PIM_WEEKLY_SUMMARY_WEBHOOK_SECRET'];
    if (typeof webhookUrl === 'string' && webhookUrl.length > 0) {
      const webhookParams: { url: string; payload: WeeklySummaryPayload; secret?: string } = {
        url: webhookUrl,
        payload,
      };
      if (typeof webhookSecret === 'string' && webhookSecret.length > 0) {
        webhookParams.secret = webhookSecret;
      }
      await dispatchWeeklySummaryWebhook(webhookParams).catch((error) => {
        logger.warn(
          { shopId: shop.id, error: error instanceof Error ? error.message : String(error) },
          'Weekly summary webhook dispatch failed'
        );
      });
    }
  }

  logger.info({ shopCount: shopsResult.rows.length }, 'Weekly cost summary generated');
  return shopsResult.rows.length;
}

export function startWeeklySummaryScheduler(logger: Logger): WeeklySummaryWorkerHandle {
  const env = loadEnv();
  const config = configFromEnv(env);
  const queue = createQueue({ config }, { name: WEEKLY_SUMMARY_QUEUE_NAME });

  void queue.add(
    WEEKLY_SUMMARY_JOB_NAME,
    {},
    {
      jobId: WEEKLY_SUMMARY_JOB_NAME,
      repeat: { pattern: '0 8 * * 1', tz: 'UTC' },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
    }
  );

  const { worker } = createWorker(
    { config },
    {
      name: WEEKLY_SUMMARY_QUEUE_NAME,
      workerOptions: { concurrency: 1 },
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => await runWeeklySummaryTick(logger)),
    }
  );

  return {
    worker,
    queue,
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
