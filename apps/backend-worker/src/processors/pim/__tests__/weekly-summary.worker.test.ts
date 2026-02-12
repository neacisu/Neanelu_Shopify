import { after, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const calls: { sql: string; params?: unknown[] }[] = [];
const fetchCalls: { url: string; headers: Record<string, string> }[] = [];

void mock.module('@app/database', {
  namedExports: {
    pool: {
      query: (sql: string, params?: unknown[]) => {
        calls.push(params ? { sql, params } : { sql });
        if (sql.includes('SELECT id FROM shops')) {
          return Promise.resolve({ rows: [{ id: 'shop-1' }] });
        }
        if (sql.includes('FROM api_usage_log')) {
          return Promise.resolve({
            rows: [{ provider: 'serper', total_cost: '1.5', total_requests: '10' }],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    },
  },
});

void mock.module('@app/config', {
  namedExports: {
    loadEnv: () => ({
      pimWeeklySummaryWebhookUrl: 'https://example.com/hook',
      pimWeeklySummaryWebhookSecret: 'secret',
    }),
  },
});

const originalFetch = globalThis.fetch;
globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
  fetchCalls.push({
    url: String(url),
    headers: (init?.headers as Record<string, string>) ?? {},
  });
  return Promise.resolve({
    ok: true,
    status: 200,
  } as Response);
}) as typeof fetch;

const { runWeeklySummaryTick } = await import('../weekly-summary.worker.js');
const previousWebhookUrl = process.env['PIM_WEEKLY_SUMMARY_WEBHOOK_URL'];
const previousWebhookSecret = process.env['PIM_WEEKLY_SUMMARY_WEBHOOK_SECRET'];
process.env['PIM_WEEKLY_SUMMARY_WEBHOOK_URL'] = 'https://example.com/hook';
process.env['PIM_WEEKLY_SUMMARY_WEBHOOK_SECRET'] = 'secret';

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
};

void describe('weekly-summary worker', () => {
  after(() => {
    globalThis.fetch = originalFetch;
    if (typeof previousWebhookUrl === 'string') {
      process.env['PIM_WEEKLY_SUMMARY_WEBHOOK_URL'] = previousWebhookUrl;
    } else {
      delete process.env['PIM_WEEKLY_SUMMARY_WEBHOOK_URL'];
    }
    if (typeof previousWebhookSecret === 'string') {
      process.env['PIM_WEEKLY_SUMMARY_WEBHOOK_SECRET'] = previousWebhookSecret;
    } else {
      delete process.env['PIM_WEEKLY_SUMMARY_WEBHOOK_SECRET'];
    }
  });

  void it('creates notification and dispatches signed webhook', async () => {
    calls.length = 0;
    fetchCalls.length = 0;

    const processed = await runWeeklySummaryTick(logger as never);
    assert.equal(processed, 1);

    const hasInsert = calls.some((entry) => entry.sql.includes('INSERT INTO pim_notifications'));
    assert.equal(hasInsert, true);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, 'https://example.com/hook');
    assert.equal(typeof fetchCalls[0]?.headers['X-Neanelu-Signature'], 'string');
  });
});
