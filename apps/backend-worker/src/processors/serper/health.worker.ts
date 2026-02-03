import type { Logger } from '@app/logger';
import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { pool } from '@app/database';
import { runSerperHealthCheck } from '../../services/serper-health.js';

export interface SerperHealthWorkerHandle {
  close: () => Promise<void>;
}

async function listSerperShops(): Promise<string[]> {
  const result = await pool.query<{ shop_id: string }>(
    `SELECT shop_id
     FROM shop_ai_credentials
     WHERE serper_enabled = true
       AND serper_api_key_ciphertext IS NOT NULL`
  );
  return result.rows.map((row) => row.shop_id);
}

export async function runSerperHealthTick(logger: Logger): Promise<void> {
  const env: AppEnv = loadEnv();
  const shopIds = await listSerperShops();
  for (const shopId of shopIds) {
    try {
      await runSerperHealthCheck({
        shopId,
        env,
        logger,
        allowStoredWhenDisabled: false,
        persist: true,
      });
    } catch (error) {
      logger.warn({ shopId, error }, 'Serper health tick failed for shop');
    }
  }
  logger.info({ shops: shopIds.length }, 'Serper health tick completed');
}

export function startSerperHealthWorker(logger: Logger): SerperHealthWorkerHandle {
  const env: AppEnv = loadEnv();
  const tickSeconds = Number(env.serperHealthCheckIntervalSeconds ?? 3600);
  const tickMs = Number.isFinite(tickSeconds) && tickSeconds > 10 ? tickSeconds * 1000 : 3600_000;

  let running = false;
  let closed = false;

  const tick = async (): Promise<void> => {
    if (running || closed) return;
    running = true;
    try {
      await runSerperHealthTick(logger);
    } catch (err) {
      logger.error({ err }, 'Serper health tick failed');
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
