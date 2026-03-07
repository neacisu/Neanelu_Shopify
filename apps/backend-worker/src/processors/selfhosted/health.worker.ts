import type { Logger } from '@app/logger';
import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { pool } from '@app/database';
import { setSelfhostedGpuVramUsedBytes, setSelfhostedHealthStatus } from '../../otel/metrics.js';
import { runSelfHostedHealthCheck } from '../../services/selfhosted-health.js';

export interface SelfHostedHealthWorkerHandle {
  close: () => Promise<void>;
}

async function listSelfHostedShops(): Promise<string[]> {
  const result = await pool.query<{ shop_id: string }>(
    `SELECT shop_id
     FROM shop_ai_credentials
     WHERE selfhosted_enabled = true
       AND selfhosted_endpoints != '[]'::jsonb`
  );
  return result.rows.map((row) => row.shop_id);
}

export async function runSelfHostedHealthTick(logger: Logger): Promise<void> {
  const env: AppEnv = loadEnv();
  const shopIds = await listSelfHostedShops();
  for (const shopId of shopIds) {
    try {
      const result = await runSelfHostedHealthCheck({
        shopId,
        env,
        logger,
        allowStoredWhenDisabled: false,
        persist: true,
      });
      setSelfhostedHealthStatus(result.status === 'ok' || result.status === 'partial');
      if (
        typeof result.gpuMetrics?.vramUsedGiB === 'number' &&
        Number.isFinite(result.gpuMetrics.vramUsedGiB)
      ) {
        setSelfhostedGpuVramUsedBytes(result.gpuMetrics.vramUsedGiB * 1024 * 1024 * 1024);
      }
    } catch (error) {
      logger.warn({ shopId, error }, 'selfhosted health tick failed for shop');
      setSelfhostedHealthStatus(false);
    }
  }
  logger.info({ shops: shopIds.length }, 'selfhosted health tick completed');
}

export function startSelfHostedHealthWorker(logger: Logger): SelfHostedHealthWorkerHandle {
  const tickMs = 60_000;

  let running = false;
  let closed = false;

  const tick = async (): Promise<void> => {
    if (running || closed) return;
    running = true;
    try {
      await runSelfHostedHealthTick(logger);
    } catch (err) {
      logger.error({ err }, 'selfhosted health tick failed');
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => void tick(), tickMs);
  void tick();

  return {
    close: async () => {
      closed = true;
      clearInterval(interval);
      await Promise.resolve();
    },
  };
}
