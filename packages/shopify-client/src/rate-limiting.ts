type HeadersLike =
  | Headers
  | {
      get(name: string): string | null | undefined;
    }
  | Record<string, string | string[] | undefined>;

function getHeader(headers: HeadersLike, name: string): string | null {
  if (!headers) return null;

  // Fetch Headers
  if (typeof (headers as Headers).get === 'function') {
    const value = (headers as Headers).get(name);
    if (value != null) return value;
    // Try lowercase for non-standard header maps.
    return (headers as Headers).get(name.toLowerCase());
  }

  // Plain object
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return null;
  const value = (headers as Record<string, string | string[] | undefined>)[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type ShopifyGraphqlThrottleStatus = Readonly<{
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}>;

export type ShopifyGraphqlCostExtensions = Readonly<{
  requestedQueryCost?: number;
  actualQueryCost?: number;
  throttleStatus?: ShopifyGraphqlThrottleStatus;
}>;

export type ShopifyGraphqlExtensions = Readonly<{
  cost?: ShopifyGraphqlCostExtensions;
}>;

export function computeGraphqlDelayMs(params: {
  costNeeded: number;
  currentlyAvailable: number;
  restoreRate: number;
}): number {
  const costNeeded = Math.max(0, params.costNeeded);
  const available = Math.max(0, params.currentlyAvailable);
  const restoreRate = params.restoreRate;

  if (available >= costNeeded) return 0;
  if (!Number.isFinite(restoreRate) || restoreRate <= 0) {
    // If Shopify doesn't tell us restoreRate, be conservative.
    return 60_000;
  }

  const deficit = costNeeded - available;
  return Math.ceil((deficit / restoreRate) * 1000);
}

export function parseRetryAfterSeconds(headers: HeadersLike): number | null {
  const raw = getHeader(headers, 'Retry-After');
  if (!raw) return null;

  // Retry-After can be seconds or an HTTP date. We handle seconds only.
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  return null;
}

export function computeRestDelayMsFromRetryAfter(headers: HeadersLike): number | null {
  const seconds = parseRetryAfterSeconds(headers);
  if (seconds == null) return null;
  return Math.ceil(seconds * 1000);
}
