import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '@app/logger';

import { logIgnoredThrottleSyncError } from '../lex-shopify-sync.js';

void describe('logIgnoredThrottleSyncError', () => {
  void test('apelează logger.warn cu context când logger este definit', () => {
    const calls: { payload: Record<string, unknown>; msg: string }[] = [];
    const logger = {
      warn: (payload: Record<string, unknown>, msg: string) => {
        calls.push({ payload, msg });
      },
    } as Logger;

    const err = new Error('redis_unavailable');
    logIgnoredThrottleSyncError(logger, err, {
      shopId: 'shop-1',
      resourceId: 'gid://shopify/Product/1',
      op: 'translations_register',
    });

    assert.equal(calls.length, 1);
    const first = calls[0];
    assert.ok(first);
    assert.ok(first.msg.includes('non-fatal'));
    assert.strictEqual(first.payload['err'], err);
    assert.strictEqual(first.payload['shopId'], 'shop-1');
    assert.strictEqual(first.payload['resourceId'], 'gid://shopify/Product/1');
    assert.strictEqual(first.payload['op'], 'translations_register');
  });

  void test('nu aruncă când logger lipsește', () => {
    assert.doesNotThrow(() =>
      logIgnoredThrottleSyncError(undefined, new Error('x'), {
        shopId: 's',
        resourceId: 'r',
        op: 'test',
      })
    );
  });
});
