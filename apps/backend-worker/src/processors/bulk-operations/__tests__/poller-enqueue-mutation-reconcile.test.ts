import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const tokenLifecyclePath = new URL('../../../auth/token-lifecycle.js', import.meta.url).href;
const shopifyClientPath = new URL('../../../shopify/client.js', import.meta.url).href;
const rateLimitPath = new URL('../../../shopify/graphql-rate-limit.js', import.meta.url).href;
const stateMachinePath = new URL('../state-machine.js', import.meta.url).href;

const MOCK_SHOPIFY_OPERATION_ID = 'gid://shopify/BulkOperation/123';
const MOCK_RESULT_URL = 'https://shopify.example/bulk/result.jsonl';
const MOCK_PARTIAL_URL = 'https://shopify.example/bulk/partial.jsonl';
const MOCK_SHOP_DOMAIN = 'test-poller-store.myshopify.com';

let capturedProcessor:
  | ((job: {
      id?: string | number | null;
      name?: string | null;
      data: unknown;
      updateData?: (data: unknown) => Promise<unknown>;
      attemptsMade?: number;
      stacktrace?: string[];
    }) => Promise<unknown>)
  | null = null;

let reconcileCalls: unknown[] = [];

await (async () => {
  await Promise.resolve(
    mock.module('@app/config', {
      namedExports: {
        SHOPIFY_API_VERSION: '2025-01',
        loadEnv: () => ({
          redisUrl: 'redis://localhost:6379/0',
          encryptionKeyHex: '00'.repeat(32),
          maxGlobalConcurrency: 1,
          maxActivePerShop: 1,
        }),
      },
    })
  );

  await Promise.resolve(
    mock.module('ioredis', {
      namedExports: {
        Redis: class FakeRedis {
          constructor(_url: string) {
            void _url;
          }
          quit(): Promise<void> {
            return Promise.resolve();
          }
          disconnect(): void {
            // noop
          }
        },
      },
    })
  );

  await Promise.resolve(
    mock.module('@app/database', {
      namedExports: {
        withTenantContext: async (
          _shopId: string,
          fn: (client: { query: () => Promise<{ rows: unknown[] }> }) => Promise<unknown>
        ) => {
          return await fn({
            query: () => Promise.resolve({ rows: [] }),
          });
        },
      },
    })
  );

  await Promise.resolve(
    mock.module('@app/queue-manager', {
      namedExports: {
        BULK_POLLER_QUEUE_NAME: 'bulk-poller-queue',
        // Required by ../failure-handler.js (imported by poller.worker).
        enqueueBulkOrchestratorJob: () => Promise.resolve(undefined),
        enqueueDlqEntry: () => Promise.resolve(undefined),
        createWorker: (
          _qmOptions: unknown,
          params: { processor: (job: unknown) => Promise<unknown> }
        ) => {
          capturedProcessor = params.processor as typeof capturedProcessor;
          return {
            worker: {
              on: () => undefined,
              close: () => Promise.resolve(undefined),
            },
            dlqQueue: {
              close: () => Promise.resolve(undefined),
            },
          };
        },
        withJobTelemetryContext: async (_job: unknown, fn: () => Promise<unknown>) => fn(),
        configFromEnv: (_env: unknown) => ({
          connection: { url: 'redis://localhost:6379/0' },
        }),
        enqueueBulkMutationReconcileJob: (payload: unknown) => {
          reconcileCalls.push(payload);
          return Promise.resolve(undefined);
        },
      },
    })
  );

  await Promise.resolve(
    mock.module(rateLimitPath, {
      namedExports: {
        getShopifyGraphqlRateLimitConfig: () => ({
          defaultBulkPollCost: 10,
        }),
        gateShopifyGraphqlRequest: () => Promise.resolve(undefined),
      },
    })
  );

  await Promise.resolve(
    mock.module(tokenLifecyclePath, {
      namedExports: {
        withTokenRetry: async <T>(
          _shopId: string,
          _encryptionKey: Buffer,
          _logger: unknown,
          fn: (accessToken: string, shopDomain: string) => Promise<T>
        ): Promise<T> => {
          return fn('shpat_test_token', MOCK_SHOP_DOMAIN);
        },
      },
    })
  );

  await Promise.resolve(
    mock.module(shopifyClientPath, {
      namedExports: {
        shopifyApi: {
          createClient: (_options: unknown) => {
            return {
              request: (query: string, variables?: Record<string, unknown>) => {
                if (!query.includes('query BulkOperationNode')) {
                  throw new Error('unexpected_query');
                }
                if (variables?.['id'] !== MOCK_SHOPIFY_OPERATION_ID) {
                  throw new Error('unexpected_operation_id');
                }

                return {
                  data: {
                    node: {
                      __typename: 'BulkOperation',
                      id: MOCK_SHOPIFY_OPERATION_ID,
                      status: 'COMPLETED',
                      errorCode: null,
                      createdAt: new Date(Date.now() - 60_000).toISOString(),
                      completedAt: new Date().toISOString(),
                      objectCount: '10',
                      fileSize: '1234',
                      url: MOCK_RESULT_URL,
                      partialDataUrl: MOCK_PARTIAL_URL,
                    },
                  },
                  extensions: {
                    cost: {
                      actualQueryCost: 10,
                      requestedQueryCost: 10,
                      throttleStatus: {
                        currentlyAvailable: 1000,
                        maximumAvailable: 1000,
                        restoreRate: 50,
                      },
                    },
                  },
                };
              },
            };
          },
        },
      },
    })
  );

  await Promise.resolve(
    mock.module(stateMachinePath, {
      namedExports: {
        insertBulkError: () => Promise.resolve(undefined),
        markBulkRunFailed: () => Promise.resolve(undefined),
        patchBulkRunCursorState: () => Promise.resolve(undefined),
        // Critical: indicate this is a mutation run.
        loadBulkRunContext: () =>
          Promise.resolve({
            cursor_state: {
              bulkMutationContract: {
                mutationType: 'metafieldsSet',
                version: 'v1',
                retryAttempt: 0,
                input: { path: '/tmp/input.jsonl' },
              },
            },
          }),
      },
    })
  );
})();

void describe('poller: enqueue mutation reconcile on completion', () => {
  void it('enqueues reconcile when cursor_state contains bulkMutationContract', async () => {
    reconcileCalls = [];

    const { startBulkPollerWorker } = await import('../poller.worker.js');

    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      fatal: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    };

    const handle = startBulkPollerWorker(logger as never);
    assert.ok(handle);

    assert.ok(capturedProcessor, 'expected createWorker mock to capture poller processor');

    const shopId = randomUUID();
    const bulkRunId = randomUUID();

    await capturedProcessor({
      id: 'job-1',
      name: 'bulk.poller',
      data: {
        shopId,
        bulkRunId,
        shopifyOperationId: MOCK_SHOPIFY_OPERATION_ID,
        triggeredBy: 'system',
        requestedAt: Date.now(),
      },
      updateData: () => Promise.resolve(undefined),
    });

    assert.equal(reconcileCalls.length, 1);
    const call = reconcileCalls[0] as Record<string, unknown>;
    assert.equal(call['shopId'], shopId);
    assert.equal(call['bulkRunId'], bulkRunId);
    assert.equal(call['resultUrl'], MOCK_RESULT_URL);

    await handle.close();
  });
});
