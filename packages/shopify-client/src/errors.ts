export type ShopifyRateLimitKind = 'rest_429' | 'graphql_throttled' | 'preflight';

export class ShopifyRateLimitedError extends Error {
  public readonly delayMs: number;
  public readonly kind: ShopifyRateLimitKind;
  public readonly details?: Record<string, unknown>;

  constructor(options: {
    delayMs: number;
    kind: ShopifyRateLimitKind;
    message?: string;
    details?: Record<string, unknown>;
  }) {
    super(options.message ?? `Shopify rate limited (${options.kind})`);
    Object.setPrototypeOf(this, ShopifyRateLimitedError.prototype);
    this.name = 'ShopifyRateLimitedError';

    const delayMs = Math.max(0, Math.floor(options.delayMs));
    this.delayMs = delayMs;
    this.kind = options.kind;
    if (options.details) {
      this.details = options.details;
    }
  }
}
