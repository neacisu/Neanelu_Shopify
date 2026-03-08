import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const routingPath = new URL('../ai-provider-routing.js', import.meta.url).href;
const guardrailsPath = new URL('../guardrails.js', import.meta.url).href;
const metricsPath = new URL('../../otel/metrics.js', import.meta.url).href;

const chatCredentials = {
  provider: 'selfhosted',
  apiKey: 'test-key',
  baseUrl: 'http://llm.local/v1',
  model: 'Qwen/Test',
  temperature: 0.2,
  maxTokensPerRequest: 2048,
  rateLimitPerMinute: 60,
};

void mock.module('@app/pim', {
  namedExports: {
    buildChatCompletionsUrl: (baseUrl: string) => `${baseUrl}/chat/completions`,
  },
});

void mock.module(routingPath, {
  namedExports: {
    getAiRoutingRedis: () => null,
    recordConsensusCircuitBreakerFailure: () => Promise.resolve(false),
    recordConsensusCircuitBreakerSuccess: () => Promise.resolve(undefined),
    resolveChatTaskCredentials: () => Promise.resolve(chatCredentials),
    resolveConsensusCredentials: () =>
      Promise.resolve({
        calls: [
          { ...chatCredentials, endpointId: 'p1', timeoutMs: 500 },
          { ...chatCredentials, endpointId: 'p2', timeoutMs: 500 },
          { ...chatCredentials, endpointId: 'p3', timeoutMs: 500 },
          { ...chatCredentials, endpointId: 'p4', timeoutMs: 500 },
        ],
        arbitration: {
          ...chatCredentials,
          endpointId: 'arb',
          model: 'QwQ/Test',
          temperature: 0,
          timeoutMs: 500,
        },
      }),
  },
});

void mock.module(guardrailsPath, {
  namedExports: {
    scanInput: ({ text }: { text: string }) =>
      Promise.resolve({
        isValid: true,
        sanitizedText: text,
        reason: null,
      }),
    scanOutput: ({ output }: { output: string }) =>
      Promise.resolve({
        isValid: true,
        sanitizedText: output,
        reason: null,
      }),
  },
});

void mock.module(metricsPath, {
  namedExports: {
    recordConsensusCircuitBreakerTrip: () => undefined,
    recordConsensusMetrics: () => undefined,
  },
});

const { areResponsesEquivalent, consensusChatCompletion, findMajority, normalizeForComparison } =
  await import('../consensus-engine.js');

const env = {
  consensusEnabled: true,
  consensusN: 4,
  consensusSkipThreshold: 0.75,
  openAiTimeoutMs: 30_000,
  redisPrefix: 'test:',
} as const;

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as const;

const originalFetch = globalThis.fetch;

void describe('consensus-engine', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  void it('normalizeForComparison unifica & si case', () => {
    assert.equal(
      normalizeForComparison(' Boilers & Accessories '),
      normalizeForComparison('boilers and accessories')
    );
  });

  void it('areResponsesEquivalent compara pe keyField', () => {
    assert.equal(
      areResponsesEquivalent({
        left: { categoryEn: 'Boilers & Accessories' },
        right: { categoryEn: 'boilers and accessories' },
        keyField: 'categoryEn',
        compareValue: undefined,
      }),
      true
    );
  });

  void it('findMajority returneaza 3 din 4', () => {
    const majority = findMajority({
      responses: [
        {
          parsed: { selectedId: 'a' },
          raw: '{}',
          model: 'm1',
          endpointId: 'e1',
          provider: 'selfhosted',
        },
        {
          parsed: { selectedId: 'a' },
          raw: '{}',
          model: 'm2',
          endpointId: 'e2',
          provider: 'selfhosted',
        },
        {
          parsed: { selectedId: 'b' },
          raw: '{}',
          model: 'm3',
          endpointId: 'e3',
          provider: 'selfhosted',
        },
        {
          parsed: { selectedId: 'a' },
          raw: '{}',
          model: 'm4',
          endpointId: 'e4',
          provider: 'selfhosted',
        },
      ],
      keyField: 'selectedId',
      compareValue: undefined,
    });

    assert.ok(majority);
    assert.equal(majority.count, 3);
    assert.equal(majority.value.parsed.selectedId, 'a');
  });

  void it('consensusChatCompletion intoarce majority fara arbitrare', async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      const payloads = [
        { selectedId: 'tax-1' },
        { selectedId: 'tax-1' },
        { selectedId: 'tax-1' },
        { selectedId: 'tax-2' },
      ];
      const content = JSON.stringify(payloads[Math.max(0, calls - 1)]);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }) as typeof fetch;

    const result = await consensusChatCompletion<{ selectedId: string }>({
      shopId: 'shop-1',
      env: env as never,
      logger: logger as never,
      taskType: 'classification',
      systemPrompt: 'system',
      userPrompt: 'user',
      responseFormat: { type: 'json_object' },
      keyField: 'selectedId',
    });

    assert.equal(result.method, 'majority');
    assert.equal(result.consensusScore, 0.75);
    assert.equal(result.result.selectedId, 'tax-1');
    assert.equal(calls, 4);
  });

  void it('consensusChatCompletion foloseste arbitrare cand raspunsurile difera', async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      const content =
        calls <= 4
          ? JSON.stringify({ selectedId: `tax-${calls}` })
          : JSON.stringify({
              selectedIndex: 2,
              consensusScore: 0.64,
              reasoning: 'Raspunsul 2 este cel mai sigur.',
              finalResult: { selectedId: 'tax-2' },
            });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }) as typeof fetch;

    const result = await consensusChatCompletion<{ selectedId: string }>({
      shopId: 'shop-1',
      env: env as never,
      logger: logger as never,
      taskType: 'classification',
      systemPrompt: 'system',
      userPrompt: 'user',
      responseFormat: { type: 'json_object' },
      keyField: 'selectedId',
    });

    assert.equal(result.method, 'arbitration');
    assert.equal(result.result.selectedId, 'tax-2');
    assert.equal(result.consensusScore, 0.64);
    assert.equal(result.arbitrationReasoning, 'Raspunsul 2 este cel mai sigur.');
    assert.equal(calls, 5);
  });
});
