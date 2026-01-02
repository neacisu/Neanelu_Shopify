/**
 * OAuth Validation Utilities
 *
 * CONFORM: Plan_de_implementare F3.2.2
 * - Validare shop domain (regex + format)
 * - Protecție împotriva open redirect / SSRF
 */

/**
 * Regex pattern pentru Shopify domain valid
 * Format: store-name.myshopify.com
 * - 2-50 caractere pentru store name
 * - Doar lowercase, numere și cratimă
 * - Nu poate începe sau termina cu cratimă
 */
const SHOPIFY_DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?\.myshopify\.com$/;

/**
 * Validează că un shop domain este format Shopify valid
 * NU face request extern - doar validare format
 */
export function isValidShopDomain(shop: unknown): shop is string {
  if (typeof shop !== 'string') return false;
  if (shop.length < 14 || shop.length > 64) return false;
  return SHOPIFY_DOMAIN_REGEX.test(shop.toLowerCase());
}

/**
 * Sanitize și normalizează shop domain
 * Returnează null dacă invalid
 */
export function sanitizeShopDomain(shop: unknown): string | null {
  if (!isValidShopDomain(shop)) return null;
  return shop.toLowerCase().trim();
}

/**
 * Validare completă cu mesaj de eroare
 */
export function validateShopParam(
  shop: unknown
): { valid: true; shop: string } | { valid: false; error: string } {
  if (shop === undefined || shop === null || shop === '') {
    return { valid: false, error: 'Missing required parameter: shop' };
  }

  if (typeof shop !== 'string') {
    return { valid: false, error: 'Parameter shop must be a string' };
  }

  const sanitized = sanitizeShopDomain(shop);
  if (!sanitized) {
    return {
      valid: false,
      error: 'Invalid shop domain format. Expected: store-name.myshopify.com',
    };
  }

  return { valid: true, shop: sanitized };
}

/**
 * Construiește URL de autorizare Shopify
 */
export function buildAuthorizationUrl(params: {
  shop: string;
  clientId: string;
  scopes: string;
  redirectUri: string;
  state: string;
}): string {
  const { shop, clientId, scopes, redirectUri, state } = params;

  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', scopes);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);

  return url.toString();
}
