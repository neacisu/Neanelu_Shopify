import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '@app/logger';

interface DescriptionJobLike {
  id: string;
  name: string;
  data: { shopId: string; productId: string; trigger: 'consensus' | 'manual' };
  attemptsMade?: number;
  opts?: { attempts?: number };
}

let capturedProcessor: ((job: DescriptionJobLike) => Promise<unknown>) | null = null;
let savedDescription: string | null = null;
let savedGeneratedBy: string | null = null;
let capturedPrompt = '';
let capturedSystemPrompt = '';
let capturedResponseFormatType: 'json_object' | 'text' | null = null;
let capturedParseResponse: ((value: string) => string) | null = null;
let mockConsensusResult = '';
let mockProductRow: {
  id: string;
  canonical_title: string;
  brand: string | null;
  specs: Record<string, unknown> | null;
  source_description: string | null;
  source_description_html: string | null;
};

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

function buildRichSourceDescription(): string {
  return Array.from(
    { length: 10 },
    () =>
      'Boilerul termoelectric Power Termo este echipat cu doua surse de incalzire, protectie la supraincalzire, protectie la suprapresiune, rezervor emailat, anod de magneziu si necesita curatare periodica pentru mentinerea performantelor in timp.'
  ).join(' ');
}

void mock.module('@app/config', {
  namedExports: {
    loadEnv: () => ({
      redisUrl: 'redis://localhost:6379',
      bullmqProToken: 'x',
      maxActivePerShop: 1,
      maxGlobalConcurrency: 1,
      starvationTimeoutMs: 1000,
      consensusEnabled: false,
      consensusN: 4,
      consensusSkipThreshold: 0.75,
      openAiTimeoutMs: 30000,
      redisPrefix: 'test:',
    }),
  },
});

void mock.module('@app/queue-manager', {
  namedExports: {
    configFromEnv: () => ({}),
    createQueue: () => ({
      getJob: () => Promise.resolve(null),
      add: () => Promise.resolve({ id: 'mock-description-job' }),
      close: () => Promise.resolve(undefined),
    }),
    withJobTelemetryContext: async (_job: unknown, fn: () => Promise<unknown>) => await fn(),
    createWorker: (
      _ctx: unknown,
      opts: { processor: (job: DescriptionJobLike) => Promise<unknown> }
    ) => {
      capturedProcessor = opts.processor;
      return { worker: { close: () => Promise.resolve() } };
    },
  },
});

void mock.module('@app/database', {
  namedExports: {
    withTenantContext: async (
      _shopId: string,
      fn: (client: {
        query: (sql: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<unknown>
    ) => {
      const client = {
        query: (sql: string, values?: readonly unknown[]) => {
          if (sql.includes('FROM prod_master pm') && sql.includes('source_description')) {
            return Promise.resolve({ rows: [mockProductRow] });
          }
          if (sql.includes('FROM pim_description_templates')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'template-1',
                  locale: 'ro',
                  min_chars: 200,
                  max_chars: 2000,
                  required_sections: ['introducere', 'caracteristici', 'utilizare'],
                  tone: 'professional',
                  prompt_template:
                    'Genereaza o descriere Golden Record pentru {{title}} de la {{brand}}. Structura: {{required_sections}}. Interval: {{min_chars}}-{{max_chars}}. Descriere sursa: {{source_description}}. Specificatii: {{specs}}.',
                },
              ],
            });
          }
          if (sql.includes('INSERT INTO prod_semantics')) {
            savedDescription = typeof values?.[2] === 'string' ? values[2] : '';
            savedGeneratedBy = typeof values?.[5] === 'string' ? values[5] : '';
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [] });
        },
      };
      return await fn(client);
    },
  },
});

void mock.module('../../../services/consensus-engine.js', {
  namedExports: {
    consensusChatCompletion: ({
      systemPrompt,
      userPrompt,
      responseFormat,
      parseResponse,
    }: {
      systemPrompt: string;
      userPrompt: string;
      responseFormat?: { type: 'json_object' | 'text' };
      parseResponse?: (value: string) => string;
    }) => {
      capturedSystemPrompt = systemPrompt;
      capturedPrompt = userPrompt;
      capturedResponseFormatType = responseFormat?.type ?? null;
      capturedParseResponse = parseResponse ?? null;
      return Promise.resolve({
        result: mockConsensusResult,
        rawResponses: [],
        method: 'single_fallback',
        consensusScore: 0.25,
        participantCount: 1,
        models: ['mock-model'],
        durationMs: 15,
      });
    },
  },
});

void mock.module('../../../runtime/worker-registry.js', {
  namedExports: {
    setWorkerCurrentJob: () => undefined,
    clearWorkerCurrentJob: () => undefined,
  },
});

void describe('description generator worker (unit)', () => {
  beforeEach(() => {
    capturedProcessor = null;
    savedDescription = null;
    savedGeneratedBy = null;
    capturedPrompt = '';
    capturedSystemPrompt = '';
    capturedResponseFormatType = null;
    capturedParseResponse = null;
    mockConsensusResult =
      'Introducere: Boilerul Power Termo 100 este o solutie detaliata pentru apa calda. Caracteristici si functionare: pastreaza sistemul cu doua surse de incalzire, protectia la supraincalzire, montajul vertical si recomandarile de intretinere. Utilizare si mentenanta: descrierea finala extinde si structureaza complet informatia originala pentru un Golden Record.';
    mockProductRow = {
      id: 'product-1',
      canonical_title: 'Boiler Power Termo 100',
      brand: 'Ferroli',
      specs: { capacity_l: 100, power_w: 1500, mounting: 'vertical' },
      source_description:
        'Boilerul termoelectric Power Termo este echipat cu doua surse de incalzire, cu protectie la supraincalzire si necesita curatare periodica.',
      source_description_html: null,
    };
  });

  void it('uses the original source description as enhancement baseline and saves the enriched result', async () => {
    const { startDescriptionGeneratorWorker } = await import('../description-generator.worker.js');
    startDescriptionGeneratorWorker(createTestLogger());
    assert.ok(capturedProcessor, 'expected createWorker mock to capture processor');

    await capturedProcessor({
      id: 'job-1',
      name: 'generate-description',
      data: { shopId: 'shop-1', productId: 'product-1', trigger: 'consensus' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    assert.match(capturedSystemPrompt, /Golden Record/i);
    assert.match(capturedSystemPrompt, /STRICT JSON/i);
    assert.equal(capturedResponseFormatType, 'json_object');
    assert.equal(capturedParseResponse?.('{"description":"Descriere finala"}'), 'Descriere finala');
    assert.equal(
      capturedParseResponse?.('```json\n{"description":"Descriere finala"}\n```'),
      'Descriere finala'
    );
    assert.equal(
      capturedParseResponse?.('Descriere finala fara JSON, dar valida.'),
      'Descriere finala fara JSON, dar valida.'
    );
    assert.match(capturedPrompt, /Descriere originala/i);
    assert.match(capturedPrompt, /doua surse de incalzire/i);
    assert.match(capturedPrompt, /nu trebuie sa fie mai sumara/i);
    assert.ok(savedDescription, 'expected enriched description to be persisted');
    assert.match(savedDescription ?? '', /doua surse de incalzire/i);
    assert.equal((savedDescription ?? '').includes('###'), false);
    assert.equal(savedGeneratedBy, 'llm_description_generator');
  });

  void it('retries instead of persisting a degraded summary when the source description is much richer', async () => {
    const { startDescriptionGeneratorWorker } = await import('../description-generator.worker.js');
    startDescriptionGeneratorWorker(createTestLogger());
    assert.ok(capturedProcessor, 'expected createWorker mock to capture processor');

    mockProductRow = {
      ...mockProductRow,
      source_description: buildRichSourceDescription(),
    };
    mockConsensusResult = 'Descriere foarte scurta.';

    await assert.rejects(
      capturedProcessor({
        id: 'job-2',
        name: 'generate-description',
        data: { shopId: 'shop-1', productId: 'product-1', trigger: 'consensus' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      }),
      /description_generation_too_short_compared_to_source/
    );

    assert.equal(savedDescription, null);
    assert.equal(savedGeneratedBy, null);
  });

  void it('falls back to the original source description on the final attempt instead of saving a degraded summary', async () => {
    const { startDescriptionGeneratorWorker } = await import('../description-generator.worker.js');
    startDescriptionGeneratorWorker(createTestLogger());
    assert.ok(capturedProcessor, 'expected createWorker mock to capture processor');

    const richSource = buildRichSourceDescription();
    mockProductRow = {
      ...mockProductRow,
      source_description: richSource,
    };
    mockConsensusResult = 'Descriere foarte scurta.';

    await capturedProcessor({
      id: 'job-3',
      name: 'generate-description',
      data: { shopId: 'shop-1', productId: 'product-1', trigger: 'consensus' },
      attemptsMade: 2,
      opts: { attempts: 3 },
    });

    assert.equal(savedDescription, richSource);
    assert.equal(savedGeneratedBy, 'source_description_fallback');
  });
});
