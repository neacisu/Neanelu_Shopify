import assert from 'node:assert';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { parseLexWatchdogShopBatchSize } from '../schedule-watchdog-config.js';

await describe('schedule-watchdog-config – parseLexWatchdogShopBatchSize', async () => {
  const envKey = 'LEX_WATCHDOG_SHOP_BATCH';
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[envKey];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = savedEnv;
    }
  });

  await test('defaults to 200 when env unset', () => {
    delete process.env[envKey];
    assert.strictEqual(parseLexWatchdogShopBatchSize(), 200);
  });

  await test('clamps to [1, 2000] for numeric env', () => {
    process.env[envKey] = '50';
    assert.strictEqual(parseLexWatchdogShopBatchSize(), 50);
    process.env[envKey] = '2500';
    assert.strictEqual(parseLexWatchdogShopBatchSize(), 2000);
    process.env[envKey] = '0';
    assert.strictEqual(parseLexWatchdogShopBatchSize(), 200);
  });

  await test('invalid env falls back to 200', () => {
    process.env[envKey] = 'not-a-number';
    assert.strictEqual(parseLexWatchdogShopBatchSize(), 200);
  });
});
