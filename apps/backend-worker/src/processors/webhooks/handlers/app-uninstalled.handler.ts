/**
 * App Uninstalled Handler
 *
 * CONFORM: Plan_de_implementare F3.3.5
 * - Mark shop as uninstalled
 * - Revoke tokens
 * - Cleanup
 */

import type { Logger } from '@app/logger';
import { withTenantContext } from '@app/database';
import { cleanupWebhookJobsForShopDomain } from '../../../queue/webhook-queue.js';
import { shopUninstalledTotal, webhookUninstalledTotal } from '../../../otel/metrics.js';

export interface AppUninstalledContext {
  shopId: string;
  shopDomain: string;
}

export async function handleAppUninstalled(
  context: AppUninstalledContext,
  logger: Logger
): Promise<void> {
  const { shopDomain, shopId } = context;

  logger.info({ shop: shopDomain }, 'Processing app/uninstalled webhook');

  try {
    // Mark as uninstalled and clear access token for security
    // We keep the record for audit/reinstall history but revoke access
    await withTenantContext(shopId, async (client) => {
      await client.query(
        `UPDATE shops 
         SET 
           uninstalled_at = now(),
           webhook_secret = NULL,
           access_token_ciphertext = ''::bytea,
           access_token_iv = ''::bytea,
           access_token_tag = ''::bytea,
           updated_at = now()
         WHERE id = $1`,
        [shopId]
      );

      // Revoke token history (defense in depth)
      await client.query('DELETE FROM shopify_tokens WHERE shop_id = $1', [shopId]);

      // Cleanup persisted webhook subscription records for this shop
      await client.query('DELETE FROM shopify_webhooks WHERE shop_id = $1', [shopId]);
    });

    // Metric (no high-cardinality labels)
    shopUninstalledTotal.add(1);
    webhookUninstalledTotal.add(1);

    // Best-effort cleanup of queued webhook jobs
    try {
      await cleanupWebhookJobsForShopDomain(shopDomain, logger);
    } catch (err) {
      logger.warn({ err, shop: shopDomain }, 'Failed webhook queue cleanup on uninstall');
    }

    logger.info({ shop: shopDomain }, 'Shop marked as uninstalled (tokens cleared)');
  } catch (err) {
    logger.error({ err, shop: shopDomain }, 'Failed to process app/uninstalled');
    throw err; // Throw to retry if DB error
  }
}
