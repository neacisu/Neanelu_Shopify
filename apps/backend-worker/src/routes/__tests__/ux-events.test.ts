import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import type { SessionConfig } from '../../auth/session.js';

const sessionPath = new URL('../../auth/session.js', import.meta.url).href;
void mock.module(sessionPath, {
  namedExports: {
    requireSession: () => (req: unknown) => {
      (req as { session?: { shopId: string } }).session = { shopId: 'shop-1' };
      return Promise.resolve();
    },
    getSessionFromRequest: () => ({ shopId: 'shop-1' }),
  },
});

const queries: { sql: string; values?: unknown[] }[] = [];
void mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      fn: (client: {
        query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<unknown>
    ) => {
      const client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> } = {
        query: (sql: string, values?: unknown[]) => {
          if (values) {
            queries.push({ sql, values });
          } else {
            queries.push({ sql });
          }
          return Promise.resolve({ rows: [] });
        },
      };
      return await fn(client);
    },
  },
});

function createTestLogger(): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    child: () => logger,
  };
  return logger;
}

void describe('ux events routes', () => {
  void it('validates body and persists to audit_logs', async () => {
    const { uxEventsRoutes } = await import('../ux-events.js');
    const app = Fastify();
    const sessionConfig: SessionConfig = {
      secret: 'test',
      cookieName: 'neanelu_session',
      maxAge: 10,
    };
    await app.register(uxEventsRoutes, {
      // uxEventsRoutes does not read env in the plugin body; keep the test minimal.
      env: {} as unknown as AppEnv,
      logger: createTestLogger(),
      sessionConfig,
    });

    const bad = await app.inject({ method: 'POST', url: '/ux/events', payload: {} });
    assert.equal(bad.statusCode, 400);

    queries.length = 0;
    const ok = await app.inject({
      method: 'POST',
      url: '/ux/events',
      payload: { name: 'drawer_open', payload: { matchId: 'm-1' } },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(queries.length, 1);
    assert.ok(queries[0]?.sql.includes('INSERT INTO audit_logs'));
    assert.equal((queries[0]?.values?.[0] as string).startsWith('ux:drawer_open'), true);
  });
});
