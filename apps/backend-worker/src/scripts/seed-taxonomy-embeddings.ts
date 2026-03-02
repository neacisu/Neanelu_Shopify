import { createEmbeddingsProvider } from '@app/ai-engine';
import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import { createLogger } from '@app/logger';
import { getShopOpenAiConfig } from '../runtime/openai-config.js';

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

  const openAi = await getShopOpenAiConfig({ shopId, env, logger });
  if (!openAi.enabled || !openAi.openAiApiKey) {
    throw new Error('OpenAI is not configured for provided shop');
  }

  const provider = createEmbeddingsProvider({
    openAiApiKey: openAi.openAiApiKey,
    ...(openAi.openAiBaseUrl ? { openAiBaseUrl: openAi.openAiBaseUrl } : {}),
    openAiEmbeddingsModel: openAi.openAiEmbeddingsModel,
    openAiTimeoutMs: env.openAiTimeoutMs,
  });
  if (!provider.isAvailable()) {
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
           AND embedding IS NULL
         ORDER BY id
         LIMIT $1 OFFSET $2`,
        [BATCH_SIZE, offset]
      );
      return res.rows;
    });
    if (rows.length === 0) break;

    const texts = rows.map((row) => `${row.name} ${toBreadcrumbText(row.breadcrumbs)}`.trim());
    const embeddings = await provider.embedTexts(texts);
    if (embeddings.length !== rows.length) {
      throw new Error('Unexpected embeddings size mismatch');
    }

    await withTenantContext(shopId, async (client) => {
      for (let i = 0; i < rows.length; i += 1) {
        const embedding = embeddings[i];
        if (!embedding || embedding.length === 0) continue;
        await client.query(`UPDATE prod_taxonomy SET embedding = $1::vector(2000) WHERE id = $2`, [
          `[${embedding.join(',')}]`,
          rows[i]?.id,
        ]);
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
