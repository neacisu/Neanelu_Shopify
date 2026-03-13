import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ConsensusCredentialSet } from '../ai-provider-routing.js';

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
} as const;

function buildDefaultConsensusSet() {
  return {
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
  };
}

let mockResolveChatTaskCredentials = () => Promise.resolve(chatCredentials);
let mockResolveConsensusCredentials: () => Promise<ConsensusCredentialSet | null> = () =>
  Promise.resolve(buildDefaultConsensusSet());
let mockAcquireSelfhostedSlot = () =>
  Promise.resolve({
    acquired: true,
    release: () => Promise.resolve(undefined),
  });
let mockRecordConsensusCircuitBreakerFailure = () => Promise.resolve(false);
let mockRecordConsensusCircuitBreakerSuccess = () => Promise.resolve(undefined);

void mock.module('@app/pim', {
  namedExports: {
    buildChatCompletionsUrl: (baseUrl: string) => `${baseUrl}/chat/completions`,
  },
});

void mock.module(routingPath, {
  namedExports: {
    acquireSelfhostedSlot: () => mockAcquireSelfhostedSlot(),
    getChatTaskMaxTokensOverride: () => undefined,
    getChatTaskTimeoutMs: ({ timeoutMs }: { timeoutMs: number }) => timeoutMs,
    getAiRoutingRedis: () => ({ mocked: true }),
    recordConsensusCircuitBreakerFailure: () => mockRecordConsensusCircuitBreakerFailure(),
    recordConsensusCircuitBreakerSuccess: () => mockRecordConsensusCircuitBreakerSuccess(),
    resolveChatTaskCredentials: () => mockResolveChatTaskCredentials(),
    resolveConsensusCredentials: () => mockResolveConsensusCredentials(),
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

const {
  areResponsesEquivalent,
  consensusChatCompletion,
  findMajority,
  normalizeForComparison,
  singleModelFetch,
} = await import('../consensus-engine.js');

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
    mockResolveChatTaskCredentials = () => Promise.resolve(chatCredentials);
    mockResolveConsensusCredentials = () => Promise.resolve(buildDefaultConsensusSet());
    mockAcquireSelfhostedSlot = () =>
      Promise.resolve({
        acquired: true,
        release: () => Promise.resolve(undefined),
      });
    mockRecordConsensusCircuitBreakerFailure = () => Promise.resolve(false);
    mockRecordConsensusCircuitBreakerSuccess = () => Promise.resolve(undefined);
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

  void it('single fallback pastreaza raspunsul text fara JSON.parse', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '**Introducere**\nDescriere text simpla.' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )) as typeof fetch;

    const result = await consensusChatCompletion<string>({
      shopId: 'shop-1',
      env: { ...env, consensusEnabled: false } as never,
      logger: logger as never,
      taskType: 'extraction',
      systemPrompt: 'system',
      userPrompt: 'user',
      responseFormat: { type: 'text' },
    });

    assert.equal(result.method, 'single_fallback');
    assert.equal(result.result, '**Introducere**\nDescriere text simpla.');
  });

  void it('singleModelFetch asteapta slotul self-hosted si aplica maxTokensOverride', async () => {
    let acquireCalls = 0;
    let fetchCalls = 0;
    let capturedMaxTokens: number | null = null;
    mockAcquireSelfhostedSlot = () => {
      acquireCalls += 1;
      if (acquireCalls < 3) {
        return Promise.resolve({
          acquired: false,
          release: () => Promise.resolve(undefined),
        });
      }
      return Promise.resolve({
        acquired: true,
        release: () => Promise.resolve(undefined),
      });
    };

    globalThis.fetch = ((_input, init) => {
      fetchCalls += 1;
      const bodyStr = typeof init?.body === 'string' ? init.body : '{}';
      const body = JSON.parse(bodyStr) as { max_tokens?: number };
      capturedMaxTokens = body.max_tokens ?? null;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Descriere finala' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    }) as typeof fetch;

    const result = await singleModelFetch({
      config: {
        ...chatCredentials,
        endpointId: 'selfhosted-chat-fast',
        timeoutMs: 5_000,
        executionGroupId: 'selfhosted-chat-host:llm.local',
        maxConcurrentGroupSlots: 1,
        maxTokensOverride: 250,
      },
      messages: [{ role: 'user', content: 'user' }],
      responseFormat: { type: 'text' },
      maxTokens: 1_000,
      env: env as never,
      logger: logger as never,
    });

    assert.equal(result, 'Descriere finala');
    assert.equal(acquireCalls, 3);
    assert.equal(fetchCalls, 1);
    assert.equal(capturedMaxTokens, 250);
  });

  void it('serializes extraction stages that share the same self-hosted execution group', async () => {
    let slotCalls = 0;
    mockResolveConsensusCredentials = () =>
      Promise.resolve({
        calls: [
          {
            ...chatCredentials,
            endpointId: 'stage1-qwen',
            model: 'Qwen/Fast-A',
            timeoutMs: 500,
            executionStage: 1,
            executionGroupId: 'selfhosted-chat-host:llm.local',
            maxConcurrentGroupSlots: 1,
          },
          {
            ...chatCredentials,
            endpointId: 'stage1-qwq',
            model: 'Qwen/Reasoning-A',
            timeoutMs: 500,
            executionStage: 1,
            executionGroupId: 'selfhosted-chat-host:llm.local',
            maxConcurrentGroupSlots: 1,
          },
          {
            ...chatCredentials,
            endpointId: 'stage2-qwen',
            model: 'Qwen/Fast-B',
            timeoutMs: 500,
            executionStage: 2,
            executionGroupId: 'selfhosted-chat-host:llm.local',
            maxConcurrentGroupSlots: 1,
          },
          {
            ...chatCredentials,
            endpointId: 'stage2-qwq',
            model: 'Qwen/Reasoning-B',
            timeoutMs: 500,
            executionStage: 2,
            executionGroupId: 'selfhosted-chat-host:llm.local',
            maxConcurrentGroupSlots: 1,
          },
        ],
        arbitration: {
          ...chatCredentials,
          endpointId: 'arb',
          model: 'Qwen/QwQ-32B-AWQ',
          temperature: 0,
          timeoutMs: 500,
          executionStage: 3,
          executionGroupId: 'selfhosted-chat-host:llm.local',
          maxConcurrentGroupSlots: 1,
        },
      });
    mockAcquireSelfhostedSlot = () => {
      slotCalls += 1;
      return Promise.resolve({
        acquired: true,
        release: () => Promise.resolve(undefined),
      });
    };

    let calls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      const content =
        calls <= 4
          ? JSON.stringify({ selectedId: `tax-${calls}` })
          : JSON.stringify({
              selectedIndex: 4,
              consensusScore: 0.71,
              reasoning: 'Ultimul raspuns este cel mai complet.',
              finalResult: { selectedId: 'tax-4' },
            });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const result = await consensusChatCompletion<{ selectedId: string }>({
      shopId: 'shop-1',
      env: env as never,
      logger: logger as never,
      taskType: 'extraction',
      systemPrompt: 'system',
      userPrompt: 'user',
      responseFormat: { type: 'json_object' },
      keyField: 'selectedId',
    });

    assert.equal(result.method, 'arbitration');
    assert.equal(result.result.selectedId, 'tax-4');
    assert.equal(calls, 5);
    assert.equal(slotCalls, 5);
    assert.equal(maxInFlight, 1);
  });

  void it('does not jump to frontier when self-hosted extraction fails at runtime', async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.reject(new TypeError('fetch failed'));
    }) as typeof fetch;

    await assert.rejects(
      consensusChatCompletion<string>({
        shopId: 'shop-1',
        env: env as never,
        logger: logger as never,
        taskType: 'extraction',
        systemPrompt: 'system',
        userPrompt: 'user',
        responseFormat: { type: 'text' },
      }),
      /fetch failed/
    );

    assert.equal(calls, 5);
  });
});
