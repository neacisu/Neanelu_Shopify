/**
 * HMAC Verification for Shopify OAuth
 *
 * CONFORM: Plan_de_implementare F3.2.3
 * - Verificare HMAC pe query string din callback
 * - Constant-time comparison pentru securitate
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifică HMAC din query params Shopify
 * Shopify trimite: ?code=...&shop=...&state=...&timestamp=...&hmac=...
 *
 * HMAC se calculează pe toate parametrii FĂRĂ hmac, sortați alfabetic
 */
export function verifyShopifyHmac(
  queryParams: Record<string, string | string[] | undefined>,
  secret: string
): boolean {
  // Extract hmac și construiește message din restul parametrilor
  const params = { ...queryParams };
  const hmac = params['hmac'];
  delete params['hmac'];

  if (typeof hmac !== 'string' || !hmac) {
    return false;
  }

  // Sortează parametrii alfabetic și construiește query string
  const sortedKeys = Object.keys(params).sort();
  const message = sortedKeys
    .map((key) => {
      const value = params[key];
      // Handle arrays (shouldn't happen în OAuth flow, dar să fim siguri)
      const stringValue = Array.isArray(value) ? value[0] : value;
      return `${key}=${stringValue ?? ''}`;
    })
    .join('&');

  // Calculează HMAC expected
  const computedHmac = createHmac('sha256', secret).update(message).digest('hex');

  // Constant-time comparison pentru a preveni timing attacks
  try {
    const hmacBuffer = Buffer.from(hmac, 'hex');
    const computedBuffer = Buffer.from(computedHmac, 'hex');

    if (hmacBuffer.length !== computedBuffer.length) {
      return false;
    }

    return timingSafeEqual(hmacBuffer, computedBuffer);
  } catch {
    return false;
  }
}

/**
 * Parsează query string din URL în object
 */
export function parseQueryString(queryString: string): Record<string, string> {
  const params: Record<string, string> = {};
  const searchParams = new URLSearchParams(queryString);
  for (const [key, value] of searchParams) {
    params[key] = value;
  }
  return params;
}
