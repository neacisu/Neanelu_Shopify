import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Redis } from 'ioredis';

type Mode = 'allow' | 'denyTokens' | 'denyRequests';
let mode: Mode = 'allow';

await Promise.resolve(
  mock.module('@app/queue-manager', {
    namedExports: {
      checkAndConsumeCost: (
        _redis: unknown,
        params: { bucketKey: string; costToConsume: number; maxTokens: number }
      ) => {
        if (mode === 'denyTokens' && params.bucketKey.includes('tokens')) {
          return Promise.resolve({
            allowed: false,
            delayMs: 500,
            tokensRemaining: 0,
            tokensNow: 0,
          });
        }
        if (mode === 'denyRequests' && params.bucketKey.includes('requests')) {
          return Promise.resolve({
            allowed: false,
            delayMs: 250,
            tokensRemaining: 10,
            tokensNow: 10,
          });
        }
        return Promise.resolve({
          allowed: true,
          delayMs: 0,
          tokensRemaining: Math.max(0, params.maxTokens - params.costToConsume),
          tokensNow: params.maxTokens,
        });
      },
    },
  })
);

const { gateOpenAiEmbeddingRequest } = await import('../openai/rate-limiter.js');

void describe('openai rate limiter', () => {
  void it('allows when both buckets allow', async () => {
    mode = 'allow';
    const result = await gateOpenAiEmbeddingRequest({
      redis: {} as Redis,
      shopId: 'shop-1',
      estimatedTokens: 100,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.delayMs, 0);
  });

  void it('denies when token bucket denies', async () => {
    mode = 'denyTokens';
    const result = await gateOpenAiEmbeddingRequest({
      redis: {} as Redis,
      shopId: 'shop-1',
      estimatedTokens: 100,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.delayMs, 500);
  });

  void it('denies when request bucket denies', async () => {
    mode = 'denyRequests';
    const result = await gateOpenAiEmbeddingRequest({
      redis: {} as Redis,
      shopId: 'shop-1',
      estimatedTokens: 100,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.delayMs, 250);
  });
});
