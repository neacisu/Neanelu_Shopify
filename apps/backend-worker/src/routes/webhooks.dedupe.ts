/**
 * Webhook Deduplication Strategy
 *
 * CONFORM: Plan_de_implementare F3.3.6
 * - Check duplicate in Redis
 * - TTL: 5 minutes (300s)
 * - Fallback: process if Redis down
 */

import type { Redis } from 'ioredis';
import type { Logger } from '@app/logger';

/**
 * Verifică dacă un webhook este duplicat
 */
export async function isDuplicateWebhook(
  redis: Redis,
  shopDomain: string,
  topic: string,
  webhookId: string,
  logger: Logger
): Promise<boolean> {
  const key = `webhook:processed:${shopDomain}:${topic}:${webhookId}`;

  try {
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (_err) {
    const error = _err as Error;
    // Fail safe: dacă Redis e jos, procesăm oricum (mai bine duplicate decât data loss)
    logger.warn(
      { err: error, webhookId },
      'Redis error checking duplicate webhook, bypassing check'
    );
    return false;
  }
}

/**
 * Marchează un webhook ca procesat
 */
export async function markWebhookProcessed(
  redis: Redis,
  shopDomain: string,
  topic: string,
  webhookId: string,
  logger: Logger,
  ttlSeconds = 300 // 5 minute default
): Promise<void> {
  const key = `webhook:processed:${shopDomain}:${topic}:${webhookId}`;

  try {
    await redis.set(key, '1', 'EX', ttlSeconds);
  } catch (_err) {
    const error = _err as Error;
    logger.warn({ err: error, webhookId }, 'Redis error marking webhook processed');
    // Nu aruncăm eroare pentru a nu bloca răspunsul 200 către Shopify
  }
}
