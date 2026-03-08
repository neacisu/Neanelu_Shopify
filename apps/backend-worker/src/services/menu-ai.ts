import type { AppEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import { toPgVectorLiteral } from '../processors/bulk-operations/pim/vector.js';
import {
  generateDualEmbeddingsBatch,
  resolveDualEmbeddingsProviders,
} from './multi-model-embedding.js';

export const FIXED_ROOT_MENU_ITEM_GIDS = [
  'gid://shopify/MenuItem/508753019147',
  'gid://shopify/MenuItem/508753510667',
  'gid://shopify/MenuItem/509621403915',
  'gid://shopify/MenuItem/509623664907',
  'gid://shopify/MenuItem/509623697675',
  'gid://shopify/MenuItem/509621436683',
  'gid://shopify/MenuItem/508753641739',
] as const;

export type MenuAssignmentAction =
  | 'created'
  | 'approved'
  | 'rejected'
  | 'set_primary'
  | 'deleted'
  | 'auto_activated'
  | 'invalidated';

export type MenuAssignmentStatus = 'active' | 'proposed' | 'approved' | 'rejected';

export type MenuAssignmentSource = 'ai' | 'manual' | 'sync' | 'reviewed_ai';

export interface MenuItemEmbeddingInput {
  title: string;
  path: readonly string[];
  level: number;
}

export interface MenuAssignmentQueryInput {
  normalizedTitleEn: string;
  originalTitle: string;
  domainSummary: string;
  disambiguationTerms: readonly string[];
}

export function buildMenuItemEmbeddingText(input: MenuItemEmbeddingInput): string {
  const safePath = input.path
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const fullPath = safePath.length > 0 ? safePath.join(' > ') : input.title.trim();
  const parentTitle = safePath.length >= 2 ? safePath[safePath.length - 2] : null;
  return [
    fullPath,
    `Title: ${input.title.trim()}`,
    `Level ${input.level}`,
    parentTitle ? `Parent: ${parentTitle}` : null,
  ]
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .join(' | ');
}

export function buildMenuAssignmentQueryText(input: MenuAssignmentQueryInput): string {
  return [
    input.normalizedTitleEn.trim(),
    input.originalTitle.trim(),
    input.domainSummary.trim(),
    ...input.disambiguationTerms.map((term) => term.trim()),
  ]
    .filter((value) => value.length > 0)
    .join(' | ');
}

export function isFixedRootMenuItem(params: {
  shopifyGid: string | null;
  level: number | null;
}): boolean {
  return (
    params.level === 1 &&
    params.shopifyGid != null &&
    FIXED_ROOT_MENU_ITEM_GIDS.includes(
      params.shopifyGid as (typeof FIXED_ROOT_MENU_ITEM_GIDS)[number]
    )
  );
}

interface MenuItemEmbeddingRow {
  id: string;
  title: string;
  path: string[] | null;
  level: number | null;
  embedding_text: string | null;
}

export interface SyncMenuItemEmbeddingsParams {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  force?: boolean;
  onProgress?: (progress: { completed: number; total: number; errors: number }) => void;
}

export interface SyncMenuItemEmbeddingsResult {
  embedded: number;
  completed: number;
  total: number;
  errors: number;
  model: string;
  dimensions: number;
}

const MENU_ITEM_EMBEDDING_BATCH_SIZE = 20;
const PRIMARY_COLLECTIONS_MENU_HANDLE = 'categorii-produse';

export async function syncMenuItemEmbeddings(
  params: SyncMenuItemEmbeddingsParams
): Promise<SyncMenuItemEmbeddingsResult> {
  const providers = await resolveDualEmbeddingsProviders({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
  });

  const rows = await withTenantContext(params.shopId, async (client) => {
    const result = await client.query<MenuItemEmbeddingRow>(
      `SELECT mi.id,
              mi.title,
              mi.path,
              mi.level,
              mi.embedding_text
         FROM shopify_menu_items mi
         JOIN shopify_menus sm
           ON sm.id = mi.menu_id
          AND sm.shop_id = mi.shop_id
        WHERE mi.shop_id = $1
          AND sm.handle = $2
          AND mi.item_type = 'COLLECTION'
          AND mi.resource_id IS NOT NULL
        ORDER BY mi.level ASC, mi.position ASC, mi.title ASC`,
      [params.shopId, PRIMARY_COLLECTIONS_MENU_HANDLE]
    );
    return result.rows;
  });

  const total = rows.length;
  let embedded = 0;
  let completed = 0;
  let errors = 0;

  const processSingleRow = async (row: MenuItemEmbeddingRow): Promise<void> => {
    const embeddingText = buildMenuItemEmbeddingText({
      title: row.title,
      path: row.path ?? [],
      level: row.level ?? 0,
    });

    if (!params.force && row.embedding_text === embeddingText) {
      completed += 1;
      params.onProgress?.({ completed, total, errors });
      return;
    }

    const embeddings = await generateDualEmbeddingsBatch({
      shopId: params.shopId,
      env: params.env,
      logger: params.logger,
      texts: [embeddingText],
      primary: providers.primary,
      secondary: providers.secondary,
    });
    const embedding = embeddings.primaryEmbeddings[0];
    if (embedding?.length !== providers.primary.model.dimensions) {
      throw new Error(
        `menu_item_embedding_dimension_mismatch:${row.id}:${embedding?.length ?? 0}:${providers.primary.model.dimensions}`
      );
    }
    const secondaryEmbedding = embeddings.secondaryEmbeddings[0] ?? null;

    await withTenantContext(params.shopId, async (client) => {
      await client.query(
        `UPDATE shopify_menu_items
            SET embedding = $1::vector(2000),
                embedding_text = $2,
                embedding_model = $3,
                embedding_secondary = $4::vector(2000),
                embedding_model_secondary = $5,
                updated_at = now()
          WHERE id = $6
            AND shop_id = $7`,
        [
          toPgVectorLiteral(embedding),
          embeddingText,
          providers.primary.model.name,
          secondaryEmbedding ? toPgVectorLiteral(secondaryEmbedding) : null,
          embeddings.secondaryModel,
          row.id,
          params.shopId,
        ]
      );
    });

    embedded += 1;
    completed += 1;
    params.onProgress?.({ completed, total, errors });
  };

  for (let index = 0; index < rows.length; index += MENU_ITEM_EMBEDDING_BATCH_SIZE) {
    const chunk = rows.slice(index, index + MENU_ITEM_EMBEDDING_BATCH_SIZE);
    const chunkToEmbed = chunk.filter((row) => {
      if (params.force) return true;
      const nextText = buildMenuItemEmbeddingText({
        title: row.title,
        path: row.path ?? [],
        level: row.level ?? 0,
      });
      return row.embedding_text !== nextText;
    });

    if (chunkToEmbed.length === 0) {
      completed += chunk.length;
      params.onProgress?.({ completed, total, errors });
      continue;
    }

    try {
      const texts = chunkToEmbed.map((row) =>
        buildMenuItemEmbeddingText({
          title: row.title,
          path: row.path ?? [],
          level: row.level ?? 0,
        })
      );
      const embeddings = await generateDualEmbeddingsBatch({
        shopId: params.shopId,
        env: params.env,
        logger: params.logger,
        texts,
        primary: providers.primary,
        secondary: providers.secondary,
      });
      if (embeddings.primaryEmbeddings.length !== chunkToEmbed.length) {
        throw new Error(
          `menu_item_embedding_batch_size_mismatch:${embeddings.primaryEmbeddings.length}:${chunkToEmbed.length}`
        );
      }

      await withTenantContext(params.shopId, async (client) => {
        for (let chunkIndex = 0; chunkIndex < chunkToEmbed.length; chunkIndex += 1) {
          const row = chunkToEmbed[chunkIndex];
          const embedding = embeddings.primaryEmbeddings[chunkIndex];
          const secondaryEmbedding = embeddings.secondaryEmbeddings[chunkIndex] ?? null;
          const embeddingText = texts[chunkIndex];
          if (!row || !embedding || !embeddingText) continue;
          if (embedding.length !== providers.primary.model.dimensions) {
            throw new Error(
              `menu_item_embedding_dimension_mismatch:${row.id}:${embedding.length}:${providers.primary.model.dimensions}`
            );
          }
          await client.query(
            `UPDATE shopify_menu_items
                SET embedding = $1::vector(2000),
                    embedding_text = $2,
                    embedding_model = $3,
                    embedding_secondary = $4::vector(2000),
                    embedding_model_secondary = $5,
                    updated_at = now()
              WHERE id = $6
                AND shop_id = $7`,
            [
              toPgVectorLiteral(embedding),
              embeddingText,
              providers.primary.model.name,
              secondaryEmbedding ? toPgVectorLiteral(secondaryEmbedding) : null,
              embeddings.secondaryModel,
              row.id,
              params.shopId,
            ]
          );
          embedded += 1;
          completed += 1;
          params.onProgress?.({ completed, total, errors });
        }
      });

      const skipped = chunk.length - chunkToEmbed.length;
      if (skipped > 0) {
        completed += skipped;
        params.onProgress?.({ completed, total, errors });
      }
    } catch (error) {
      params.logger.warn(
        {
          err: error,
          shopId: params.shopId,
          chunkSize: chunk.length,
          chunkStart: index,
        },
        'menu_item_embedding_chunk_failed_falling_back_to_single'
      );

      for (const row of chunk) {
        try {
          await processSingleRow(row);
        } catch (rowError) {
          errors += 1;
          completed += 1;
          params.onProgress?.({ completed, total, errors });
          params.logger.warn(
            {
              err: rowError,
              shopId: params.shopId,
              menuItemId: row.id,
            },
            'menu_item_embedding_row_failed'
          );
        }
      }
    }
  }

  return {
    embedded,
    completed,
    total,
    errors,
    model: providers.secondary?.isAvailable()
      ? `${providers.primary.model.name} + ${providers.secondary.model.name}`
      : providers.primary.model.name,
    dimensions: providers.primary.model.dimensions,
  };
}
