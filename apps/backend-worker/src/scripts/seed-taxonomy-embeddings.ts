import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import { createLogger } from '@app/logger';
import { toPgVectorLiteral } from '../processors/bulk-operations/pim/vector.js';
import {
  generateDualEmbeddingsBatch,
  resolveDualEmbeddingsProviders,
} from '../services/multi-model-embedding.js';

type TaxonomyRow = Readonly<{
  id: string;
  name: string;
  breadcrumbs: unknown;
}>;

const BATCH_SIZE = 100;

function parseArgs(): { shopId: string } {
  const shopIdArg = process.argv.find((arg) => arg.startsWith('--shop-id=')) ?? '';
  const shopId = shopIdArg.slice('--shop-id='.length).trim();
  if (!shopId) {
    throw new Error('Missing --shop-id=<uuid>');
  }
  return { shopId };
}

function toBreadcrumbText(value: unknown): string {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(' ');
  }
  if (typeof value === 'string') return value;
  try {
    const asObj = value as { labels?: unknown };
    if (Array.isArray(asObj?.labels)) {
      return asObj.labels.map((item) => String(item)).join(' ');
    }
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    service: 'seed-taxonomy-embeddings',
    env: env.nodeEnv,
    level: env.logLevel,
  });
  const { shopId } = parseArgs();

  const providers = await resolveDualEmbeddingsProviders({ shopId, env, logger });
  if (!providers.primary.isAvailable()) {
    throw new Error('Embeddings provider not available');
  }

  let offset = 0;
  let processed = 0;
  while (true) {
    const rows = await withTenantContext(shopId, async (client) => {
      const res = await client.query<TaxonomyRow>(
        `SELECT id, name, breadcrumbs
         FROM prod_taxonomy
         WHERE is_active = true
           AND (
                 embedding IS NULL
              OR ($1::text IS NOT NULL AND embedding_secondary IS NULL)
           )
         ORDER BY id
         LIMIT $2 OFFSET $3`,
        [providers.secondary?.model.name ?? null, BATCH_SIZE, offset]
      );
      return res.rows;
    });
    if (rows.length === 0) break;

    const texts = rows.map((row) => `${row.name} ${toBreadcrumbText(row.breadcrumbs)}`.trim());
    const embeddings = await generateDualEmbeddingsBatch({
      shopId,
      env,
      logger,
      texts,
      primary: providers.primary,
      secondary: providers.secondary,
    });
    if (embeddings.primaryEmbeddings.length !== rows.length) {
      throw new Error('Unexpected embeddings size mismatch');
    }

    await withTenantContext(shopId, async (client) => {
      for (let i = 0; i < rows.length; i += 1) {
        const embedding = embeddings.primaryEmbeddings[i];
        const secondaryEmbedding = embeddings.secondaryEmbeddings[i] ?? null;
        if (!embedding || embedding.length === 0) continue;
        await client.query(
          `UPDATE prod_taxonomy
              SET embedding = $1::vector(2000),
                  model_version = $3,
                  embedding_secondary = $4::vector(2000),
                  model_version_secondary = $5,
                  updated_at = now()
            WHERE id = $2`,
          [
            toPgVectorLiteral(embedding),
            rows[i]?.id,
            providers.primary.model.name,
            secondaryEmbedding ? toPgVectorLiteral(secondaryEmbedding) : null,
            embeddings.secondaryModel,
          ]
        );
      }
    });

    processed += rows.length;
    offset += rows.length;
    logger.info({ processed }, 'taxonomy embeddings batch completed');
  }

  logger.info({ processed }, 'taxonomy embeddings seed completed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
