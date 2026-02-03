import type { Logger } from '@app/logger';
import type { AppEnv } from '@app/config';
import { loadEnv } from '@app/config';
import { pool } from '@app/database';
import { runOpenAiHealthCheck } from '../../services/openai-health.js';

export interface OpenAiHealthWorkerHandle {
  close: () => Promise<void>;
}

async function listOpenAiShops(): Promise<string[]> {
  const result = await pool.query<{ shop_id: string }>(
    `SELECT shop_id
     FROM shop_ai_credentials
     WHERE enabled = true
       AND openai_api_key_ciphertext IS NOT NULL`
  );
  return result.rows.map((row) => row.shop_id);
}

export async function runOpenAiHealthTick(logger: Logger): Promise<void> {
  const env: AppEnv = loadEnv();
  const shopIds = await listOpenAiShops();
  for (const shopId of shopIds) {
    try {
      await runOpenAiHealthCheck({
        shopId,
        env,
        logger,
        allowStoredWhenDisabled: false,
        persist: true,
      });
    } catch (error) {
      logger.warn({ shopId, error }, 'OpenAI health tick failed for shop');
    }
  }
  logger.info({ shops: shopIds.length }, 'OpenAI health tick completed');
}

export function startOpenAiHealthWorker(logger: Logger): OpenAiHealthWorkerHandle {
  const env: AppEnv = loadEnv();
  const tickSeconds = Number(env.openAiHealthCheckIntervalSeconds ?? 3600);
  const tickMs = Number.isFinite(tickSeconds) && tickSeconds > 10 ? tickSeconds * 1000 : 3600_000;

  let running = false;
  let closed = false;

  const tick = async (): Promise<void> => {
    if (running || closed) return;
    running = true;
    try {
      await runOpenAiHealthTick(logger);
    } catch (err) {
      logger.error({ err }, 'OpenAI health tick failed');
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
