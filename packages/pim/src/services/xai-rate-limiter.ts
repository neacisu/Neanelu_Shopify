import { acquireProviderRateLimit } from './rate-limiter.js';

export async function acquireXaiRateLimit(params: {
  shopId: string;
  rateLimitPerMinute: number;
}): Promise<void> {
  await acquireProviderRateLimit({
    provider: 'xai',
    shopId: params.shopId,
    rateLimitPerMinute: params.rateLimitPerMinute,
  });
}
