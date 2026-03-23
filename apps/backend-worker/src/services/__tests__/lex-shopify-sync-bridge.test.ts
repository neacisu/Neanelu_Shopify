import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '@app/logger';

import { syncPublishedTargetsToShopify } from '../lex-shopify-sync-bridge.js';

function createTestLogger(): Logger {
  const self: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    child: () => self,
  };
  return self;
}

void describe('lex-shopify-sync-bridge', () => {
  void test('syncPublishedTargetsToShopify: fără id-uri nu atinge env/DB (early return)', async () => {
    await assert.doesNotReject(() =>
      syncPublishedTargetsToShopify({
        shopId: '550e8400-e29b-41d4-a716-446655440000',
        publishedTargetIds: [],
        logger: createTestLogger(),
      })
    );
  });
});
