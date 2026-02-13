import { describe, expect, it, vi } from 'vitest';

import { computeHmacSignature } from '../utils/hmac.js';
import {
  buildQualityPayload,
  dispatchQualityWebhook,
  generateWebhookSecret,
  type QualityEventRecord,
} from '../services/webhook-dispatcher.js';

describe('webhook-dispatcher', () => {
  it('generates a 32-byte hex secret', () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds quality payload from event', () => {
    const event: QualityEventRecord = {
      id: 'evt-1',
      eventType: 'quality_promoted',
      productId: 'prod-1',
      previousLevel: 'bronze',
      newLevel: 'silver',
      qualityScoreBefore: 0.51,
      qualityScoreAfter: 0.84,
      triggerReason: 'threshold_met',
      createdAt: '2026-02-01T00:00:00.000Z',
      webhookSent: false,
      webhookSentAt: null,
      sku: 'SKU-1',
    };
    const payload = buildQualityPayload(event, 'shop-1');
    expect(payload.event_type).toBe('quality_promoted');
    expect(payload.shop_id).toBe('shop-1');
    expect(payload.quality_score).toBe(0.84);
  });

  it('dispatches signed webhook once and returns success', async () => {
    const fetchMock = vi.fn(() => ({
      ok: true,
      status: 202,
      text: () => Promise.resolve('accepted'),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const payload = {
      event_type: 'quality_promoted',
      event_id: 'evt-test',
      product_id: 'prod-test',
      sku: 'SKU-T',
      previous_level: 'bronze',
      new_level: 'silver',
      quality_score: 0.9,
      trigger_reason: 'test',
      timestamp: new Date().toISOString(),
      shop_id: 'shop-test',
    } as const;
    const secret = 'x'.repeat(64);

    const result = await dispatchQualityWebhook({
      url: 'https://example.com/webhooks',
      payload,
      secret,
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('computes deterministic signature', () => {
    const sig1 = computeHmacSignature('abc', '123', '{"x":1}');
    const sig2 = computeHmacSignature('abc', '123', '{"x":1}');
    expect(sig1).toBe(sig2);
  });
});
