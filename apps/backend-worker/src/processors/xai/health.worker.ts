import type { Logger } from '@app/logger';
import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { pool } from '@app/database';
import { runXaiHealthCheck } from '../../services/xai-health.js';

export interface XaiHealthWorkerHandle {
  close: () => Promise<void>;
}

async function listXaiShops(): Promise<string[]> {
  const result = await pool.query<{ shop_id: string }>(
    `SELECT shop_id
     FROM shop_ai_credentials
     WHERE xai_enabled = true
       AND xai_api_key_ciphertext IS NOT NULL`
  );
  return result.rows.map((row) => row.shop_id);
}

export async function runXaiHealthTick(logger: Logger): Promise<void> {
  const env: AppEnv = loadEnv();
  const shopIds = await listXaiShops();
  for (const shopId of shopIds) {
    try {
      await runXaiHealthCheck({
        shopId,
        env,
        logger,
        allowStoredWhenDisabled: false,
        persist: true,
      });
    } catch (error) {
      logger.warn({ shopId, error }, 'xAI health tick failed for shop');
    }
  }
  logger.info({ shops: shopIds.length }, 'xAI health tick completed');
}

export function startXaiHealthWorker(logger: Logger): XaiHealthWorkerHandle {
  const env: AppEnv = loadEnv();
  const tickSeconds = Number(env.xaiHealthCheckIntervalSeconds ?? 3600);
  const tickMs = Number.isFinite(tickSeconds) && tickSeconds > 10 ? tickSeconds * 1000 : 3600_000;

  let running = false;
  let closed = false;

  const tick = async (): Promise<void> => {
    if (running || closed) return;
    running = true;
    try {
      await runXaiHealthTick(logger);
    } catch (err) {
      logger.error({ err }, 'xAI health tick failed');
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
