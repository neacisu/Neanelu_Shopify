/**
 * Token Health Check Job
 *
 * CONFORM: Plan_de_implementare F3.2.5
 * - Job periodic pentru verificare stare tokens
 * - Integrare cu BullMQ
 */

import type { Logger } from '@app/logger';
import { getShopsForHealthCheck, checkTokenHealth, markNeedsReauth } from '../token-lifecycle.js';

/**
 * Configurare job
 */
export interface TokenHealthJobConfig {
  encryptionKey: Buffer;
  batchSize: number;
  intervalMs: number;
}

/**
 * Rezultat procesare batch
 */
export interface TokenHealthJobResult {
  processed: number;
  valid: number;
  invalid: number;
  markedForReauth: number;
  errors: number;
}

/**
 * Procesează un batch de shop-uri pentru health check
 * Aceasta este funcția care va fi apelată de worker-ul BullMQ
 */
export async function processTokenHealthBatch(
  config: TokenHealthJobConfig,
  logger: Logger
): Promise<TokenHealthJobResult> {
  const result: TokenHealthJobResult = {
    processed: 0,
    valid: 0,
    invalid: 0,
    markedForReauth: 0,
    errors: 0,
  };

  // Obține lista de shop-uri pentru verificare
  const shopIds = await getShopsForHealthCheck(config.batchSize);

  logger.info({ count: shopIds.length }, 'Starting token health check batch');

  for (const shopId of shopIds) {
    result.processed++;

    try {
      const healthResult = await checkTokenHealth(shopId, config.encryptionKey, logger);

      if (healthResult.valid) {
        result.valid++;
      } else {
        result.invalid++;

        if (healthResult.needsReauth) {
          await markNeedsReauth(shopId, healthResult.reason ?? 'Health check failed');
          result.markedForReauth++;
          logger.warn({ shopId, reason: healthResult.reason }, 'Shop marked for reauth');
        }
      }
    } catch (err) {
      result.errors++;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ shopId, errorMessage }, 'Error processing shop in health check');
    }
  }

  logger.info({ ...result }, 'Token health check batch completed');
  return result;
}

/**
 * Definește job-ul pentru BullMQ
 * Aceasta este configurația care se pasează la Queue.add()
 */
export const TOKEN_HEALTH_JOB_NAME = 'token-health-check';

export interface TokenHealthJobData {
  triggeredBy: 'scheduler' | 'manual';
  timestamp: number;
}

/**
 * Opțiuni pentru job repetat (cron-style)
 * Se adaugă la queue cu: queue.add(name, data, { repeat: ... })
 */
export const TOKEN_HEALTH_REPEAT_OPTIONS = {
  pattern: '0 */6 * * *', // La fiecare 6 ore
  limit: 1000, // Maxim 1000 de execuții
};

/**
 * Factory pentru crearea configurației job-ului
 */
export function createTokenHealthJobConfig(
  encryptionKeyHex: string,
  batchSize = 50
): TokenHealthJobConfig {
  return {
    encryptionKey: Buffer.from(encryptionKeyHex, 'hex'),
    batchSize,
    intervalMs: 6 * 60 * 60 * 1000, // 6 ore
  };
}
