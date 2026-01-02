/**
 * HMAC Verification for Shopify Webhooks
 *
 * CONFORM: Plan_de_implementare F3.3.1
 * - Constant-time comparison
 * - Uses raw body buffer
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify Shopify Webhook HMAC
 *
 * @param rawBody - The raw request body buffer
 * @param secret - The Shopify API Secret
 * @param signature - The X-Shopify-Hmac-Sha256 header value
 * @returns true if valid, false otherwise
 */
export function verifyWebhookHmac(
  rawBody: Buffer,
  secret: string,
  signature: string | string[] | undefined
): boolean {
  if (!signature || !rawBody) {
    return false;
  }

  const signatureStr = Array.isArray(signature) ? signature[0] : signature;
  if (!signatureStr) return false;

  try {
    const generatedHash = createHmac('sha256', secret).update(rawBody).digest('base64');

    // Convert strings to Buffers for timingSafeEqual
    const signatureBuffer = Buffer.from(signatureStr);
    const generatedBuffer = Buffer.from(generatedHash);

    // Length check first to prevent error in timingSafeEqual
    if (signatureBuffer.length !== generatedBuffer.length) {
      return false;
    }

    return timingSafeEqual(signatureBuffer, generatedBuffer);
  } catch {
    // Orice eroare de crypto/parsing fail
    return false;
  }
}
