export const SHOPIFY_API_VERSION_DEFAULT = '2025-10';
export const SHOPIFY_API_VERSION_FALLBACK = '2025-07';

function normalizeApiVersion(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return SHOPIFY_API_VERSION_DEFAULT;
  return trimmed;
}

export const SHOPIFY_API_VERSION = normalizeApiVersion(process.env['SHOPIFY_API_VERSION']);

export function getShopifyApiVersions(): readonly [primary: string, fallback: string] {
  const primary = SHOPIFY_API_VERSION;
  const fallback = SHOPIFY_API_VERSION_FALLBACK;
  return [primary, fallback];
}

export function getShopifyApiVersionsUnique(): readonly string[] {
  const [primary, fallback] = getShopifyApiVersions();
  return primary === fallback ? [primary] : [primary, fallback];
}
