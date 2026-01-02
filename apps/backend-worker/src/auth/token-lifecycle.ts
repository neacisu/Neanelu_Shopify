/**
 * Token Lifecycle Management
 *
 * CONFORM: Plan_de_implementare F3.2.5
 * - Detectare token invalid/expirat la apel API
 * - Marcare shop ca needing_reauth
 * - Job periodic pentru verificare stare tokens
 * - Previne retry infinit
 */

import { pool, decryptAesGcm } from '@app/database';
import type { Logger } from '@app/logger';

/**
 * Rezultat verificare token
 */
export interface TokenHealthResult {
  valid: boolean;
  needsReauth: boolean;
  reason?: string;
}

/**
 * Verifică sănătatea unui token pentru un shop
 * Returnează starea tokenului și dacă necesită reautorizare
 */
export async function checkTokenHealth(
  shopId: string,
  encryptionKey: Buffer,
  logger: Logger
): Promise<TokenHealthResult> {
  try {
    // 1. Încarcă token info din DB
    const result = await pool.query<{
      access_token_ciphertext: string;
      access_token_iv: string;
      access_token_tag: string;
      shopify_domain: string;
    }>(
      `SELECT access_token_ciphertext, access_token_iv, access_token_tag, shopify_domain
       FROM shops
       WHERE id = $1`,
      [shopId]
    );

    const shop = result.rows[0];
    if (!shop) {
      return { valid: false, needsReauth: true, reason: 'Shop not found' };
    }

    // 2. Verifică dacă token-ul există
    if (!shop.access_token_ciphertext) {
      return { valid: false, needsReauth: true, reason: 'No token stored' };
    }

    // 3. Decriptează token pentru validare
    let accessToken: string;
    try {
      const decrypted = decryptAesGcm(
        Buffer.from(shop.access_token_ciphertext, 'base64'),
        encryptionKey,
        Buffer.from(shop.access_token_iv, 'base64'),
        Buffer.from(shop.access_token_tag, 'base64')
      );
      accessToken = decrypted.toString('utf-8');
    } catch {
      return { valid: false, needsReauth: true, reason: 'Token decryption failed' };
    }

    // 4. Verifică token cu un request simplu la Shopify
    try {
      const response = await fetch(`https://${shop.shopify_domain}/admin/api/2025-10/shop.json`, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': accessToken,
        },
      });

      if (response.status === 401 || response.status === 403) {
        return { valid: false, needsReauth: true, reason: 'Token rejected by Shopify' };
      }

      if (!response.ok) {
        logger.warn(
          { shopId, status: response.status },
          'Unexpected response when checking token health'
        );
        // Nu marcăm ca needsReauth pentru alte erori (poate fi problemă temporară)
        return { valid: false, needsReauth: false, reason: `HTTP ${response.status}` };
      }

      return { valid: true, needsReauth: false };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ shopId, errorMessage }, 'Network error checking token health');
      // Eroare de rețea - nu marcăm ca needsReauth (poate fi temporar)
      return { valid: false, needsReauth: false, reason: errorMessage };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ shopId, errorMessage }, 'Error checking token health');
    return { valid: false, needsReauth: false, reason: errorMessage };
  }
}

/**
 * Marchează un shop ca necesitând reautorizare
 * Setează un flag în settings și uninstalled_at
 */
export async function markNeedsReauth(shopId: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE shops
     SET settings = settings || $1::jsonb,
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify({ needs_reauth: true, reauth_reason: reason }), shopId]
  );
}

/**
 * Verifică dacă un shop necesită reautorizare
 */
export async function needsReauth(shopId: string): Promise<boolean> {
  const result = await pool.query<{ needs_reauth: boolean }>(
    `SELECT (settings->>'needs_reauth')::boolean as needs_reauth
     FROM shops
     WHERE id = $1`,
    [shopId]
  );

  return result.rows[0]?.needs_reauth === true;
}

/**
 * Șterge flag-ul de reautorizare după reinstall reușit
 */
export async function clearReauthFlag(shopId: string): Promise<void> {
  await pool.query(
    `UPDATE shops
     SET settings = settings - 'needs_reauth' - 'reauth_reason',
         updated_at = now()
     WHERE id = $1`,
    [shopId]
  );
}

/**
 * Găsește toate shop-urile care necesită verificare token
 * (pentru job periodic)
 */
export async function getShopsForHealthCheck(limit = 100): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM shops
     WHERE access_token_ciphertext IS NOT NULL
       AND uninstalled_at IS NULL
       AND (settings->>'needs_reauth')::boolean IS NOT TRUE
     ORDER BY updated_at ASC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => row.id);
}

/**
 * Wrapper pentru execuție cu detecție automată de token invalid
 * Nu face retry infinit - marchează shop și aruncă eroare
 */
export async function withTokenRetry<T>(
  shopId: string,
  encryptionKey: Buffer,
  logger: Logger,
  fn: (accessToken: string, shopDomain: string) => Promise<T>
): Promise<T> {
  // 1. Verifică dacă shop-ul necesită deja reauth
  if (await needsReauth(shopId)) {
    throw new Error('Shop requires reauthorization');
  }

  // 2. Încarcă și decriptează token
  const result = await pool.query<{
    access_token_ciphertext: string;
    access_token_iv: string;
    access_token_tag: string;
    shopify_domain: string;
  }>(
    `SELECT access_token_ciphertext, access_token_iv, access_token_tag, shopify_domain
     FROM shops
     WHERE id = $1`,
    [shopId]
  );

  const shop = result.rows[0];
  if (!shop?.access_token_ciphertext) {
    throw new Error('Shop not found or no token');
  }

  const accessToken = decryptAesGcm(
    Buffer.from(shop.access_token_ciphertext, 'base64'),
    encryptionKey,
    Buffer.from(shop.access_token_iv, 'base64'),
    Buffer.from(shop.access_token_tag, 'base64')
  ).toString('utf-8');

  // 3. Execută funcția
  try {
    return await fn(accessToken, shop.shopify_domain);
  } catch (err) {
    // 4. Verifică dacă eroarea este din cauza token-ului invalid
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Detectăm erori de autorizare
    if (
      errorMessage.includes('401') ||
      errorMessage.includes('403') ||
      errorMessage.includes('Unauthorized') ||
      errorMessage.includes('Access denied')
    ) {
      logger.warn({ shopId }, 'Token appears invalid, marking for reauth');
      await markNeedsReauth(shopId, errorMessage);
    }

    throw err;
  }
}
