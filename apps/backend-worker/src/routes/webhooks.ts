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
import { enqueueWebhookJob } from '../queue/webhook-queue.js';
import { validateWebhookJobPayload, type WebhookJobPayload } from '@app/types';
import { sanitizeShopDomain } from '../auth/validation.js';
import { createHash } from 'node:crypto';

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

export const webhookRoutes: FastifyPluginCallback = (app, _opts, done) => {
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
    // Topic is extracted from headers, so the URL path is less critical validation-wise
    // as long as we capture the request.
    // const { topic: urlTopic } = request.params;
    const rawBody = request.body as Buffer;

    if (rawBody.length > WEBHOOK_BODY_LIMIT_BYTES) {
      request.log.warn({ size: rawBody.length }, 'Webhook payload too large');
      return reply.code(413).send({ error: 'Payload too large' });
    }

    // 1. Headers Validation
    const hmac = request.headers['x-shopify-hmac-sha256'] as string;
    const shopDomainRaw = request.headers['x-shopify-shop-domain'] as string;
    const headerTopic = request.headers['x-shopify-topic'] as string;
    const webhookId = request.headers['x-shopify-webhook-id'] as string;

    if (!hmac || !shopDomainRaw || !headerTopic || !webhookId) {
      request.log.warn('Missing required Shopify webhook headers');
      return reply.code(400).send({ error: 'Missing required headers' });
    }

    const shopDomain = sanitizeShopDomain(shopDomainRaw);
    if (!shopDomain) {
      request.log.warn({ shopDomain: shopDomainRaw }, 'Invalid shop domain header');
      return reply.code(400).send({ error: 'Invalid shop domain' });
    }

    // 2. HMAC Validation (Security Critical)
    const isValid = verifyWebhookHmac(rawBody, env.shopifyApiSecret, hmac);

    if (!isValid) {
      request.log.warn({ shop: shopDomain }, 'Invalid webhook HMAC signature');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    // 3. Comparison check (URL vs Header)
    // Sometimes topics have slashes, so verify basic alignment or just trust header
    // Header topic is the source of truth

    // 4. Deduplication
    const isDuplicate = await isDuplicateWebhook(
      redis,
      shopDomain,
      headerTopic,
      webhookId,
      request.log
    );
    if (isDuplicate) {
      request.log.info({ webhookId, shop: shopDomain }, 'Duplicate webhook detected, skipping');
      return reply.code(200).send(); // Idempotent success
    }

    // 5. Build Payload
    // Parse the body now that we verified signature
    const rawJson = rawBody.toString('utf8');
    try {
      // Validate JSON is well-formed (payload content is stored out-of-band)
      JSON.parse(rawJson);
    } catch (err) {
      request.log.error({ err }, 'Failed to parse webhook JSON body');
      return reply.code(400).send({ error: 'Invalid JSON' });
    }

    // Store payload out-of-band (TTL) and enqueue only a reference.
    // This keeps the job payload minimal and avoids sensitive payload duplication.
    const payloadSha256 = createHash('sha256').update(rawJson, 'utf8').digest('hex');
    const payloadRef = `webhook:payload:${shopDomain}:${headerTopic}:${webhookId}`;
    try {
      await redis.set(payloadRef, rawJson, 'EX', WEBHOOK_PAYLOAD_TTL_SECONDS);
    } catch (err) {
      request.log.error({ err, shop: shopDomain }, 'Failed to store webhook payload');
      return reply.code(503).send({ error: 'Temporarily unable to accept webhook' });
    }

    const jobPayload: WebhookJobPayload = {
      shopDomain,
      topic: headerTopic,
      webhookId,
      receivedAt: new Date().toISOString(),
      payloadRef,
      payloadSha256,
    };

    if (!validateWebhookJobPayload(jobPayload)) {
      request.log.error({ jobPayload }, 'Invalid webhook job payload (contract violation)');
      return reply.code(500).send({ error: 'Internal error' });
    }

    // 6. Enqueue (Minimal)
    await enqueueWebhookJob(jobPayload, request.log);

    // 7. Mark Processed (Dedupe)
    await markWebhookProcessed(redis, shopDomain, headerTopic, webhookId, request.log);

    // 8. Respond OK
    return reply.code(200).send();
  });

  done();
};
