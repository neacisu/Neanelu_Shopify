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
           access_token_ciphertext = '',
           access_token_iv = '',
           access_token_tag = '',
           updated_at = now()
         WHERE id = $1`,
        [shopId]
      );

      // Revoke token history (defense in depth)
      await client.query('DELETE FROM shopify_tokens WHERE shop_id = $1', [shopId]);

      // Cleanup persisted webhook subscription records for this shop
      await client.query('DELETE FROM shopify_webhooks WHERE shop_id = $1', [shopId]);
    });

    logger.info({ shop: shopDomain }, 'Shop marked as uninstalled (tokens cleared)');
  } catch (err) {
    logger.error({ err, shop: shopDomain }, 'Failed to process app/uninstalled');
    throw err; // Throw to retry if DB error
  }
}
