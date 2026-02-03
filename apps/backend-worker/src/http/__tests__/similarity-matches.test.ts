import { test, mock } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';

import { similarityMatchesRoutes } from '../../routes/similarity-matches.js';

void mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      cb: (client: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => Promise<unknown>
    ) => {
      const client = {
        query: (_sql: string) => Promise.resolve({ rows: [] }) as Promise<{ rows: unknown[] }>,
      };
      return cb(client);
    },
  },
});

void mock.module('@app/pim', {
  namedExports: {
    searchProductByGTIN: () => Promise.resolve([]),
    searchProductByMPN: () => Promise.resolve([]),
    searchProductByTitle: () => Promise.resolve([]),
    SimilarityMatchService: class {
      createMatchWithTriage() {
        return Promise.resolve({ success: true, triageDecision: 'auto_approve' });
      }
    },
  },
});

void test('similarity routes cer sesiune', async () => {
  const app = Fastify();
  await app.register(fastifyCookie);

  await app.register(similarityMatchesRoutes, {
    env: { nodeEnv: 'test' } as never,
    logger: { info: () => undefined } as never,
    sessionConfig: {
      secret: 'test-secret',
      cookieName: 'session',
      maxAge: 3600,
    },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/similarity-matches',
    payload: {},
  });

  assert.strictEqual(response.statusCode, 401);
  await app.close();
});
