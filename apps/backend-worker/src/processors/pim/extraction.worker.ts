import { createHash } from 'crypto';

import type { Logger } from '@app/logger';
import { loadEnv } from '@app/config';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { withTenantContext } from '@app/database';
import {
  createExtractionSession,
  updateSpecsExtracted,
  XaiExtractorService,
  SimpleHTMLFetcher,
} from '@app/pim';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { loadXAICredentials } from '../../services/xai-credentials.js';
import { enqueueConsensusJob } from '../../queue/consensus-queue.js';

const warnLogger = (logger: Logger) =>
  logger as Logger & {
    warn: (data: Record<string, unknown>, message: string) => void;
  };

interface XaiCredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokensPerRequest: number;
  rateLimitPerMinute: number;
  dailyBudget: number;
  budgetAlertThreshold: number;
}

interface ExtractionResult {
  success: boolean;
  data?: Record<string, unknown> & {
    confidence?: { overall?: number; fieldsUncertain?: string[] };
  };
  tokensUsed: { input: number; output: number };
  latencyMs: number;
  error?: string;
}

interface Extractor {
  extractProductFromHTML: (params: {
    html: string;
    sourceUrl: string;
    shopId: string;
    credentials: XaiCredentials;
    matchId?: string;
    productId?: string;
  }) => Promise<ExtractionResult>;
}

interface NewExtractionSession {
  harvestId: string;
  agentVersion: string;
  modelName?: string;
  extractedSpecs: Record<string, unknown>;
  groundingSnippets?: Record<string, unknown>;
  confidenceScore?: number;
  fieldConfidences?: Record<string, unknown>;
  tokensUsed?: number;
  latencyMs?: number;
  errorMessage?: string;
}

interface Fetcher {
  fetchHTML: (url: string) => Promise<{
    html: string;
    statusCode: number;
    contentType: string;
    fetchedAt: Date;
    error?: string;
  }>;
}

type SimpleHTMLFetcherConstructor = new () => Fetcher;

type LoadXAICredentialsFn = (params: {
  shopId: string;
  encryptionKeyHex: string;
}) => Promise<XaiCredentials | null>;

type CreateExtractionSessionFn = (params: NewExtractionSession) => Promise<{ id: string }>;

type UpdateSpecsExtractedFn = (params: {
  id: string;
  specsExtracted: Record<string, unknown>;
  extractionSessionId: string;
}) => Promise<void>;

const loadXAICredentialsSafe = loadXAICredentials as LoadXAICredentialsFn;
const createExtractionSessionSafe = createExtractionSession as CreateExtractionSessionFn;
const updateSpecsExtractedSafe = updateSpecsExtracted as UpdateSpecsExtractedFn;
const SimpleHTMLFetcherSafe = SimpleHTMLFetcher as unknown as SimpleHTMLFetcherConstructor;

type ExtractorConstructor = new () => Extractor;

const XaiExtractorServiceSafe = XaiExtractorService as unknown as ExtractorConstructor;

export const PIM_EXTRACTION_QUEUE_NAME = 'pim-extraction';
export const PIM_EXTRACTION_JOB = 'extract-specs';

type ExtractionJobPayload = Readonly<{
  shopId: string;
  matchId: string;
}>;

export interface ExtractionWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startExtractionWorker(logger: Logger): ExtractionWorkerHandle {
  const env = loadEnv();
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: PIM_EXTRACTION_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('pim-extraction-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });

          try {
            if (job.name !== PIM_EXTRACTION_JOB) {
              throw new Error(`unknown_extraction_job:${job.name}`);
            }

            const payload = job.data as ExtractionJobPayload | null;
            if (!payload?.shopId || !payload.matchId) {
              throw new Error('invalid_extraction_payload');
            }

            const match = await withTenantContext(payload.shopId, async (client) => {
              const result = await client.query<{
                id: string;
                source_url: string;
                product_id: string | null;
                source_id: string | null;
              }>(
                `SELECT id, source_url, product_id, source_id
                   FROM prod_similarity_matches
                  WHERE id = $1`,
                [payload.matchId]
              );
              return result.rows[0] ?? null;
            });

            if (!match) {
              warnLogger(logger).warn({ matchId: payload.matchId }, 'Extraction match not found');
              return;
            }

            const existingHarvest = await withTenantContext(payload.shopId, async (client) => {
              const result = await client.query<{ id: string; raw_html: string | null }>(
                `SELECT id, raw_html
                   FROM prod_raw_harvest
                  WHERE source_url = $1
                  ORDER BY fetched_at DESC
                  LIMIT 1`,
                [match.source_url]
              );
              return result.rows[0] ?? null;
            });

            let harvestId = existingHarvest?.id ?? null;
            let html = existingHarvest?.raw_html ?? null;

            if (!html) {
              const fetcher = new SimpleHTMLFetcherSafe();
              const fetched = await fetcher.fetchHTML(match.source_url);
              if (fetched.error || !fetched.html) {
                warnLogger(logger).warn(
                  { matchId: payload.matchId, error: fetched.error },
                  'Failed to fetch HTML for extraction'
                );
                return;
              }

              html = fetched.html;
              const contentHash = createHash('sha256').update(html).digest('hex');
              const sourceId = await withTenantContext(payload.shopId, async (client) => {
                return resolveSourceId(client, match.source_id, match.source_url);
              });

              harvestId = await withTenantContext(payload.shopId, async (client) => {
                const insert = await client.query<{ id: string }>(
                  `INSERT INTO prod_raw_harvest (
                     source_id,
                     source_url,
                     raw_json,
                     raw_html,
                     http_status,
                     processing_status,
                     content_hash,
                     fetched_at,
                     created_at
                   )
                   VALUES ($1, $2, $3, $4, $5, 'pending', $6, now(), now())
                   RETURNING id`,
                  [
                    sourceId,
                    match.source_url,
                    JSON.stringify({}),
                    html,
                    fetched.statusCode,
                    contentHash,
                  ]
                );
                return insert.rows[0]?.id ?? null;
              });
            }

            if (!harvestId || !html) {
              warnLogger(logger).warn(
                { matchId: payload.matchId },
                'Missing harvest data for extraction'
              );
              return;
            }

            const credentials = await loadXAICredentialsSafe({
              shopId: payload.shopId,
              encryptionKeyHex: env.encryptionKeyHex,
            });
            if (!credentials) {
              warnLogger(logger).warn(
                { shopId: payload.shopId },
                'xAI credentials missing for extraction'
              );
              return;
            }

            const extractor = new XaiExtractorServiceSafe();
            const extraction = await extractor.extractProductFromHTML({
              html,
              sourceUrl: match.source_url,
              shopId: payload.shopId,
              credentials,
              ...(match.id ? { matchId: match.id } : {}),
              ...(match.product_id ? { productId: match.product_id } : {}),
            });

            const confidenceOverall = extraction.data?.confidence?.overall;
            const fieldsUncertain = extraction.data?.confidence?.fieldsUncertain;
            const extractedSpecs = extraction.data ?? {};

            const sessionPayload: NewExtractionSession = {
              harvestId,
              agentVersion: 'xai-extractor-v1.0',
              modelName: credentials.model,
              extractedSpecs,
              tokensUsed: extraction.tokensUsed.input + extraction.tokensUsed.output,
              latencyMs: extraction.latencyMs,
            };

            if (confidenceOverall !== undefined) {
              sessionPayload.confidenceScore = confidenceOverall;
            }
            if (fieldsUncertain) {
              sessionPayload.fieldConfidences = { fieldsUncertain };
            }
            if (extraction.error) {
              sessionPayload.errorMessage = extraction.error;
            }

            const session = await createExtractionSessionSafe(sessionPayload);

            if (extraction.data) {
              await updateSpecsExtractedSafe({
                id: match.id,
                specsExtracted: extractedSpecs,
                extractionSessionId: session.id,
              });

              if (match.product_id) {
                await enqueueConsensusJob({
                  shopId: payload.shopId,
                  productId: match.product_id,
                  trigger: 'extraction_complete',
                });
              }
            }
          } finally {
            clearWorkerCurrentJob('pim-extraction-worker', jobId);
          }
        }),
    }
  );

  return {
    worker,
    close: async () => {
      await worker.close();
    },
  };
}

async function resolveSourceId(
  client: { query: <T>(sql: string, params: unknown[]) => Promise<{ rows: T[] }> },
  sourceId: string | null,
  sourceUrl: string
): Promise<string> {
  if (sourceId) return sourceId;

  let hostname = 'unknown';
  let baseUrl = sourceUrl;
  try {
    const parsed = new URL(sourceUrl);
    hostname = parsed.hostname;
    baseUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {
    // keep defaults
  }

  const name = `external-${hostname}`.slice(0, 100);
  const existing = await client.query<{ id: string }>(
    `SELECT id
       FROM prod_sources
      WHERE name = $1
      LIMIT 1`,
    [name]
  );
  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO prod_sources (name, source_type, base_url, priority, trust_score, is_active, created_at, updated_at)
     VALUES ($1, 'SCRAPER', $2, 50, 0.5, true, now(), now())
     RETURNING id`,
    [name, baseUrl]
  );
  const insertedId = inserted.rows[0]?.id;
  if (!insertedId) {
    throw new Error('Failed to resolve prod_sources entry for extraction');
  }
  return insertedId;
}
