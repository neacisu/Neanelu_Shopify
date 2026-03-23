import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const featureFlagsPath = new URL(
  '../../processors/bulk-operations/feature-flags.js',
  import.meta.url
).href;
const openAiConfigPath = new URL('../../runtime/openai-config.js', import.meta.url).href;
const metricsPath = new URL('../../otel/metrics.js', import.meta.url).href;
const selfhostedCredentialsPath = new URL('../selfhosted-credentials.js', import.meta.url).href;
const xaiCredentialsPath = new URL('../xai-credentials.js', import.meta.url).href;

mock.module('@app/ai-engine', {
  namedExports: {
    createEmbeddingsProvider: () => ({
      kind: 'openai',
      isAvailable: () => true,
      embedTexts: () => Promise.resolve([]),
      model: { name: 'test', dimensions: 1 },
    }),
    createSelfhostedEmbeddingsProvider: () => ({
      kind: 'selfhosted',
      isAvailable: () => true,
      embedTexts: () => Promise.resolve([]),
      model: { name: 'test', dimensions: 1 },
    }),
  },
});

mock.module('@app/database', {
  namedExports: {
    decryptAesGcm: () => Buffer.from('test-key', 'utf8'),
    withTenantContext: () => Promise.resolve(null),
  },
});

mock.module(featureFlagsPath, {
  namedExports: {
    isFeatureFlagEnabled: () => Promise.resolve(false),
  },
});

mock.module(openAiConfigPath, {
  namedExports: {
    getShopOpenAiConfig: () => Promise.resolve(null),
  },
});

mock.module(metricsPath, {
  namedExports: {
    recordAiProviderRouting: () => undefined,
    recordSelfhostedFallbackToFrontier: () => undefined,
    setSelfhostedCircuitBreakerState: () => undefined,
  },
});

mock.module(selfhostedCredentialsPath, {
  namedExports: {
    loadSelfHostedCredentials: () => Promise.resolve(null),
  },
});

mock.module(xaiCredentialsPath, {
  namedExports: {
    loadXAICredentials: () => Promise.resolve(null),
  },
});

const { getChatTaskMaxTokensOverride, getChatTaskTimeoutMs } =
  await import('../ai-provider-routing.js');

void describe('ai-provider-routing', () => {
  void it('keeps non-selfhosted timeouts unchanged', () => {
    assert.equal(
      getChatTaskTimeoutMs({
        taskType: 'extraction',
        provider: 'openai',
        model: 'gpt-4o-mini',
        timeoutMs: 30_000,
      }),
      30_000
    );
  });

  void it('raises selfhosted fast extraction calls to at least 90s', () => {
    assert.equal(
      getChatTaskTimeoutMs({
        taskType: 'extraction',
        provider: 'selfhosted',
        model: 'Qwen/Qwen2.5-14B-Instruct-AWQ',
        endpointId: 'selfhosted-chat-fast',
        timeoutMs: 30_000,
      }),
      90_000
    );
  });

  void it('raises selfhosted reasoning extraction calls to at least 120s', () => {
    assert.equal(
      getChatTaskTimeoutMs({
        taskType: 'extraction',
        provider: 'selfhosted',
        model: 'Qwen/QwQ-32B-AWQ',
        endpointId: 'selfhosted-chat-reasoning',
        timeoutMs: 45_000,
      }),
      120_000
    );
  });

  void it('caps selfhosted fast extraction outputs to a short, stable budget', () => {
    assert.equal(
      getChatTaskMaxTokensOverride({
        taskType: 'extraction',
        provider: 'selfhosted',
        model: 'Qwen/Qwen2.5-14B-Instruct-AWQ',
        endpointId: 'selfhosted-chat-fast',
      }),
      250
    );
  });

  void it('keeps selfhosted reasoning extraction outputs large enough for final synthesis', () => {
    assert.equal(
      getChatTaskMaxTokensOverride({
        taskType: 'extraction',
        provider: 'selfhosted',
        model: 'Qwen/QwQ-32B-AWQ',
        endpointId: 'selfhosted-chat-reasoning',
      }),
      1000
    );
  });

  void it('keeps non-extraction selfhosted tasks unchanged', () => {
    assert.equal(
      getChatTaskTimeoutMs({
        taskType: 'classification',
        provider: 'selfhosted',
        model: 'Qwen/Qwen2.5-14B-Instruct-AWQ',
        endpointId: 'selfhosted-chat-fast',
        timeoutMs: 30_000,
      }),
      30_000
    );
  });
});
