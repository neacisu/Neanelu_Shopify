/**
 * Webhook Ingress Route
 *
 * CONFORM: Plan_de_implementare F3.3.1
 * - Raw body parser
 * - Header validation
 * - HMAC validation
 * - Deduplication
 * - Enqueue
 * - Fast response
 */

import type { FastifyPluginCallback } from 'fastify';
import { loadEnv } from '@app/config';
import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { verifyWebhookHmac } from './webhooks.hmac.js';
import { isDuplicateWebhook, markWebhookProcessed } from './webhooks.dedupe.js';
import { enqueueWebhookJob } from '@app/queue-manager';
import { validateWebhookJobPayload, type WebhookJobPayload } from '@app/types';
import { sanitizeShopDomain } from '../auth/validation.js';
import { createHash } from 'node:crypto';
import type { Logger } from '@app/logger';
import { withSpan, withSpanSync } from '@app/logger';
import { pool } from '@app/database';
import {
  incrementWebhookMetric,
  webhookHmacDuration,
  webhookPayloadSizeBytes,
  webhookProcessingDuration,
} from '../otel/metrics.js';

// Load env
const env = loadEnv();

// Redis connection for deduplication
// We use a separate connection or reuse one, but for simplicity here we create new
// Ideally this should be injected or shared
// Ideally this should be injected or shared
const RedisCtor = Redis as unknown as new (url: string) => RedisClient;
const redis: RedisClient = new RedisCtor(env.redisUrl);

const WEBHOOK_BODY_LIMIT_BYTES = 1_048_576; // 1 MiB
const WEBHOOK_PAYLOAD_TTL_SECONDS = 300; // 5 minutes

const SHOP_ID_LOOKUP_TIMEOUT_MS = 250;
const SHOP_ID_CACHE_TTL_MS = 60_000;
const shopIdCache = new Map<string, { shopId: string; expiresAtMs: number }>();

async function withTimeout<T>(label: string, fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs).unref();
  });
  return Promise.race([fn(), timeout]);
}

async function getShopIdByDomainCached(shopDomain: string): Promise<string | null> {
  const now = Date.now();
  const cached = shopIdCache.get(shopDomain);
  if (cached && cached.expiresAtMs > now) return cached.shopId;

  const result = await pool.query<{ id: string }>(
    'SELECT id FROM shops WHERE shopify_domain = $1 LIMIT 1',
    [shopDomain]
  );
  const shopId = result.rows[0]?.id ?? null;
  if (shopId) {
    shopIdCache.set(shopDomain, { shopId, expiresAtMs: now + SHOP_ID_CACHE_TTL_MS });
  }
  return shopId;
}

export const webhookRoutes: FastifyPluginCallback<{ appLogger?: Logger }> = (app, opts, done) => {
  // Add content type parser for raw body to handle HMAC verification
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    try {
      done(null, body);
    } catch (err) {
      done(err as Error);
    }
  });

  // Use wildcard to capture all topics including those with slashes (e.g. products/create)
  app.post('/*', async (request, reply) => {
    const appLogger = opts?.appLogger;
    const log = appLogger ?? (request.log as unknown as Logger);

    const startNs = process.hrtime.bigint();

    // Topic is extracted from headers, so the URL path is less critical validation-wise
    // as long as we capture the request.
    // const { topic: urlTopic } = request.params;
    const rawBody = request.body as Buffer;

    if (rawBody.length > WEBHOOK_BODY_LIMIT_BYTES) {
      incrementWebhookMetric('rejected', { reason: 'payload_too_large' });
      log.warn({ size: rawBody.length }, 'Webhook payload too large');
      return reply.code(413).send({ error: 'Payload too large' });
    }

    webhookPayloadSizeBytes.record(rawBody.length, { route: '/webhooks/*' });

    // 1. Headers Validation
    const hmac = request.headers['x-shopify-hmac-sha256'] as string;
    const shopDomainRaw = request.headers['x-shopify-shop-domain'] as string;
    const headerTopic = request.headers['x-shopify-topic'] as string;
    const webhookId = request.headers['x-shopify-webhook-id'] as string;

    if (!hmac || !shopDomainRaw || !headerTopic || !webhookId) {
      incrementWebhookMetric('rejected', { reason: 'missing_headers' });
      log.warn({}, 'Missing required Shopify webhook headers');
      return reply.code(400).send({ error: 'Missing required headers' });
    }

    const shopDomain = sanitizeShopDomain(shopDomainRaw);
    if (!shopDomain) {
      incrementWebhookMetric('rejected', { reason: 'invalid_shop', topic: headerTopic });
      log.warn({ shopDomain: shopDomainRaw }, 'Invalid shop domain header');
      return reply.code(400).send({ error: 'Invalid shop domain' });
    }

    // 2. HMAC Validation (Security Critical)
    const hmacStartNs = process.hrtime.bigint();
    const isValid = withSpanSync(
      'webhooks.hmac_verify',
      { shop_domain: shopDomain, topic: headerTopic },
      () => verifyWebhookHmac(rawBody, env.shopifyApiSecret, hmac)
    );
    webhookHmacDuration.record(Number(process.hrtime.bigint() - hmacStartNs) / 1_000_000_000, {
      topic: headerTopic,
    });

    if (!isValid) {
      incrementWebhookMetric('rejected', { reason: 'invalid_hmac', topic: headerTopic });
      log.warn({ shop: shopDomain }, 'Invalid webhook HMAC signature');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    // 3. Comparison check (URL vs Header)
    // Sometimes topics have slashes, so verify basic alignment or just trust header
    // Header topic is the source of truth

    // 4. Deduplication
    const isDuplicate = await withSpan(
      'webhooks.dedupe_check',
      { shop_domain: shopDomain, topic: headerTopic },
      async () => isDuplicateWebhook(redis, shopDomain, headerTopic, webhookId, request.log)
    );
    if (isDuplicate) {
      incrementWebhookMetric('duplicate', { topic: headerTopic });
      log.info({ webhookId, shop: shopDomain }, 'Duplicate webhook detected, skipping');
      return reply.code(200).send(); // Idempotent success
    }

    // 5. Build Payload
    // Parse the body now that we verified signature
    const rawJson = rawBody.toString('utf8');
    try {
      // Validate JSON is well-formed (payload content is stored out-of-band)
      JSON.parse(rawJson);
    } catch (err) {
      incrementWebhookMetric('rejected', { reason: 'invalid_json', topic: headerTopic });
      log.error({ err }, 'Failed to parse webhook JSON body');
      return reply.code(400).send({ error: 'Invalid JSON' });
    }

    // Store payload out-of-band (TTL) and enqueue only a reference.
    // This keeps the job payload minimal and avoids sensitive payload duplication.
    const payloadSha256 = createHash('sha256').update(rawJson, 'utf8').digest('hex');
    const payloadRef = `webhook:payload:${shopDomain}:${headerTopic}:${webhookId}`;
    try {
      await redis.set(payloadRef, rawJson, 'EX', WEBHOOK_PAYLOAD_TTL_SECONDS);
    } catch (err) {
      // Treat as transient error (we did accept the request but can't persist minimal ref)
      incrementWebhookMetric('rejected', { reason: 'storage_unavailable', topic: headerTopic });
      log.error({ err, shop: shopDomain }, 'Failed to store webhook payload');
      return reply.code(503).send({ error: 'Temporarily unable to accept webhook' });
    }

    const jobPayloadBase = {
      shopDomain,
      topic: headerTopic,
      webhookId,
      receivedAt: new Date().toISOString(),
      payloadRef,
      payloadSha256,
    };

    // 6. Resolve tenant (shopId) for Groups fairness + RLS
    const shopId = await withSpan(
      'webhooks.shop_id_lookup',
      { shop_domain: shopDomain },
      async () =>
        withTimeout(
          'shop_id_lookup',
          () => getShopIdByDomainCached(shopDomain),
          SHOP_ID_LOOKUP_TIMEOUT_MS
        )
    ).catch((err) => {
      incrementWebhookMetric('rejected', { reason: 'shop_id_lookup_timeout', topic: headerTopic });
      log.error({ err, shop: shopDomain }, 'Shop ID lookup timed out');
      return '__timeout__' as const;
    });

    if (shopId === '__timeout__') {
      return reply.code(503).send({ error: 'Temporarily unable to accept webhook' });
    }

    if (!shopId) {
      // Unknown shop: treat as non-retriable (stop Shopify retries).
      incrementWebhookMetric('rejected', { reason: 'unknown_shop', topic: headerTopic });
      log.warn({ shop: shopDomain, topic: headerTopic }, 'Webhook received for unknown shop');
      return reply.code(200).send();
    }

    const jobPayload: WebhookJobPayload = { ...jobPayloadBase, shopId };
    if (!validateWebhookJobPayload(jobPayload)) {
      incrementWebhookMetric('rejected', { reason: 'invalid_json', topic: headerTopic });
      log.error({ jobPayload }, 'Invalid webhook job payload (contract violation)');
      return reply.code(500).send({ error: 'Internal error' });
    }

    // 7. Enqueue (Minimal)
    await withSpan(
      'webhooks.enqueue',
      { shop_domain: shopDomain, topic: headerTopic, outcome: 'accepted' },
      async () => enqueueWebhookJob(jobPayload, log)
    );
    incrementWebhookMetric('accepted', { topic: headerTopic });

    // 8. Mark Processed (Dedupe)
    await markWebhookProcessed(redis, shopDomain, headerTopic, webhookId, request.log);

    webhookProcessingDuration.record(Number(process.hrtime.bigint() - startNs) / 1_000_000_000, {
      topic: headerTopic,
    });

    // 9. Respond OK
    return reply.code(200).send();
  });

  done();
};
