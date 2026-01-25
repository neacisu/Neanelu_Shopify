/**
 * Embedding Content Builder Service
 *
 * PR-047: F6.1.2 - Content builder service for PIM embeddings
 *
 * Provides:
 * - computeAndPersistPending: Create pending embedding records
 * - shouldCreateVariantEmbedding: Guard for variant material difference
 * - Integration with PIM database connection
 */

import {
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
  EMBEDDING_LANG,
} from '../../content/embedding-constants.js';

import {
  type ProductInput,
  type VariantInput,
  type TaxonomyNode,
  type MaterialDifferenceConfig,
  type EmbeddingSource,
  DEFAULT_MATERIAL_DIFFERENCE_CONFIG,
} from '../../content/embedding-types.js';

import { buildEmbeddingContent } from '../../content/embedding-builder.js';

// ============================================
// Types
// ============================================

/**
 * Database client interface (compatible with pg.PoolClient)
 */
export interface DatabaseClient {
  query<T extends Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<{ rows: T[] }>;
}

/**
 * Logger interface
 */
export interface Logger {
  debug(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Service configuration
 */
export interface ContentBuilderServiceConfig {
  /** Material difference configuration */
  materialDifferenceConfig: MaterialDifferenceConfig;
  /** Whether to skip variants that are not materially different */
  skipSimilarVariants: boolean;
  /** Default embedding source */
  defaultSource: EmbeddingSource;
}

/**
 * Result of computing pending embeddings
 */
export interface ComputePendingResult {
  /** Number of pending records created */
  created: number;
  /** Number of records skipped (already up-to-date) */
  skipped: number;
  /** IDs of created pending records */
  pendingIds: string[];
  /** Content hashes of created records */
  contentHashes: string[];
}

// ============================================
// Default Configuration
// ============================================

const DEFAULT_SERVICE_CONFIG: ContentBuilderServiceConfig = {
  materialDifferenceConfig: DEFAULT_MATERIAL_DIFFERENCE_CONFIG,
  skipSimilarVariants: true,
  defaultSource: 'shopify',
};

// ============================================
// Embedding Content Builder Service
// ============================================

/**
 * Service for building and persisting embedding content.
 *
 * This service:
 * - Builds deterministic embedding content using the content builder
 * - Creates pending embedding records in the database
 * - Handles variant material difference detection
 * - Supports quality level enrichment stages
 *
 * Note: This service does NOT generate embeddings - it creates pending
 * records that will be processed by the embedding batch job (PR-048).
 */
export class EmbeddingContentBuilderService {
  private readonly config: ContentBuilderServiceConfig;
  private readonly logger: Logger | null;

  constructor(config: Partial<ContentBuilderServiceConfig> = {}, logger?: Logger) {
    this.config = { ...DEFAULT_SERVICE_CONFIG, ...config };
    this.logger = logger ?? null;
  }

  /**
   * Compute embedding content and persist pending records for a product.
   *
   * This method:
   * 1. Builds embedding content for the product
   * 2. Checks if the content hash has changed
   * 3. Creates a pending embedding record if new/changed
   * 4. Optionally creates variant-specific embeddings
   *
   * @param client - Database client
   * @param product - Product data
   * @param taxonomyNode - Taxonomy node (optional)
   * @param variants - Variants to process (optional)
   * @returns Result with counts and IDs
   */
  async computeAndPersistPending(
    client: DatabaseClient,
    product: ProductInput,
    taxonomyNode: TaxonomyNode | null = null,
    variants: readonly VariantInput[] = []
  ): Promise<ComputePendingResult> {
    const result: ComputePendingResult = {
      created: 0,
      skipped: 0,
      pendingIds: [],
      contentHashes: [],
    };

    // 1. Build and persist product-level embedding
    const productResult = await this.persistProductEmbedding(client, product, taxonomyNode);
    if (productResult.created) {
      result.created++;
      result.pendingIds.push(productResult.pendingId);
      result.contentHashes.push(productResult.contentHash);
    } else {
      result.skipped++;
    }

    // 2. Process variants if provided
    for (const variant of variants) {
      // Check if variant should have its own embedding
      if (this.config.skipSimilarVariants && !this.shouldCreateVariantEmbedding(product, variant)) {
        this.logger?.debug(
          { productId: product.id, variantId: variant.id },
          'Skipping variant - not materially different'
        );
        result.skipped++;
        continue;
      }

      const variantResult = await this.persistVariantEmbedding(
        client,
        product,
        variant,
        taxonomyNode
      );
      if (variantResult.created) {
        result.created++;
        result.pendingIds.push(variantResult.pendingId);
        result.contentHashes.push(variantResult.contentHash);
      } else {
        result.skipped++;
      }
    }

    this.logger?.info(
      { productId: product.id, created: result.created, skipped: result.skipped },
      'Computed pending embeddings'
    );

    return result;
  }

  /**
   * Determine if a variant is "materially different" from the product
   * and should have its own embedding.
   *
   * A variant is materially different if it has:
   * - Different specs for key attributes
   * - Different images (beyond threshold)
   * - Different description (beyond threshold)
   *
   * @param product - Parent product
   * @param variant - Variant to check
   * @returns true if variant should have its own embedding
   */
  shouldCreateVariantEmbedding(product: ProductInput, variant: VariantInput): boolean {
    const config = this.config.materialDifferenceConfig;

    // Check specs difference
    if (config.checkSpecs && variant.specs) {
      for (const key of config.specKeys) {
        const productValue = product.specs?.[key]?.value;
        const variantValue = variant.specs[key]?.value;

        if (productValue !== undefined && variantValue !== undefined) {
          if (String(productValue) !== String(variantValue)) {
            return true;
          }
        } else if (variantValue !== undefined && productValue === undefined) {
          return true;
        }
      }
    }

    // Check images difference
    if (config.checkImages) {
      const productImages = new Set(product.imageUrls);
      const variantImages = variant.imageUrls;
      let differentImages = 0;

      for (const img of variantImages) {
        if (!productImages.has(img)) {
          differentImages++;
        }
      }

      if (differentImages >= config.minImageDiff) {
        return true;
      }
    }

    // Check description difference
    if (config.checkDescriptions && variant.description) {
      const productDesc = product.description ?? '';
      const variantDesc = variant.description;

      const lengthDiff = Math.abs(productDesc.length - variantDesc.length);
      if (lengthDiff >= config.minDescriptionLengthDiff) {
        return true;
      }

      // Also check if content is actually different (not just length)
      if (productDesc !== variantDesc) {
        // Calculate simple similarity
        const similarity = calculateSimpleSimilarity(productDesc, variantDesc);
        if (similarity < 0.9) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Persist a product-level embedding record
   */
  private async persistProductEmbedding(
    client: DatabaseClient,
    product: ProductInput,
    taxonomyNode: TaxonomyNode | null
  ): Promise<{ created: boolean; pendingId: string; contentHash: string }> {
    // Build content
    const buildResult = buildEmbeddingContent(product, taxonomyNode, null, {
      qualityLevel: product.qualityLevel,
    });

    // Check if embedding already exists with same hash
    const existingResult = await client.query<{ id: string }>(
      `SELECT id FROM prod_embeddings 
       WHERE product_id = $1 
         AND variant_id IS NULL 
         AND quality_level = $2 
         AND content_hash = $3`,
      [product.id, product.qualityLevel, buildResult.hash]
    );

    const existingRow = existingResult.rows[0];
    if (existingRow) {
      return {
        created: false,
        pendingId: existingRow.id,
        contentHash: buildResult.hash,
      };
    }

    // Insert or update pending record
    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO prod_embeddings (
         product_id,
         variant_id,
         embedding_type,
         content_hash,
         model_version,
         dimensions,
         quality_level,
         source,
         lang,
         created_at,
         updated_at
       ) VALUES ($1, NULL, 'combined', $2, $3, $4, $5, $6, $7, now(), now())
       ON CONFLICT (product_id, variant_id, quality_level, embedding_type)
       DO UPDATE SET
         content_hash = EXCLUDED.content_hash,
         model_version = EXCLUDED.model_version,
         updated_at = now()
       RETURNING id`,
      [
        product.id,
        buildResult.hash,
        EMBEDDING_MODEL,
        EMBEDDING_DIM,
        product.qualityLevel,
        this.config.defaultSource,
        EMBEDDING_LANG,
      ]
    );

    const insertedRow = insertResult.rows[0];
    if (!insertedRow) {
      throw new Error(`Failed to insert embedding record for product ${product.id}`);
    }

    return {
      created: true,
      pendingId: insertedRow.id,
      contentHash: buildResult.hash,
    };
  }

  /**
   * Persist a variant-level embedding record
   */
  private async persistVariantEmbedding(
    client: DatabaseClient,
    product: ProductInput,
    variant: VariantInput,
    taxonomyNode: TaxonomyNode | null
  ): Promise<{ created: boolean; pendingId: string; contentHash: string }> {
    // Build content with variant
    const buildResult = buildEmbeddingContent(product, taxonomyNode, variant, {
      qualityLevel: product.qualityLevel,
      includeVariantContent: true,
    });

    // Check if embedding already exists with same hash
    const existingResult = await client.query<{ id: string }>(
      `SELECT id FROM prod_embeddings 
       WHERE product_id = $1 
         AND variant_id = $2 
         AND quality_level = $3 
         AND content_hash = $4`,
      [product.id, variant.id, product.qualityLevel, buildResult.hash]
    );

    const existingRow = existingResult.rows[0];
    if (existingRow) {
      return {
        created: false,
        pendingId: existingRow.id,
        contentHash: buildResult.hash,
      };
    }

    // Insert or update pending record
    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO prod_embeddings (
         product_id,
         variant_id,
         embedding_type,
         content_hash,
         model_version,
         dimensions,
         quality_level,
         source,
         lang,
         created_at,
         updated_at
       ) VALUES ($1, $2, 'combined', $3, $4, $5, $6, $7, $8, now(), now())
       ON CONFLICT (product_id, variant_id, quality_level, embedding_type)
       DO UPDATE SET
         content_hash = EXCLUDED.content_hash,
         model_version = EXCLUDED.model_version,
         updated_at = now()
       RETURNING id`,
      [
        product.id,
        variant.id,
        buildResult.hash,
        EMBEDDING_MODEL,
        EMBEDDING_DIM,
        product.qualityLevel,
        this.config.defaultSource,
        EMBEDDING_LANG,
      ]
    );

    const insertedRow = insertResult.rows[0];
    if (!insertedRow) {
      throw new Error(
        `Failed to insert variant embedding record for product ${product.id}, variant ${variant.id}`
      );
    }

    return {
      created: true,
      pendingId: insertedRow.id,
      contentHash: buildResult.hash,
    };
  }

  /**
   * Get pending embeddings count for a product
   */
  async getPendingCount(client: DatabaseClient, productId: string): Promise<number> {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM prod_embeddings 
       WHERE product_id = $1 AND embedding IS NULL`,
      [productId]
    );
    const row = result.rows[0];
    return parseInt(row?.count ?? '0', 10);
  }

  /**
   * Check if product needs re-embedding
   */
  async needsReEmbedding(
    client: DatabaseClient,
    product: ProductInput,
    taxonomyNode: TaxonomyNode | null = null
  ): Promise<boolean> {
    const buildResult = buildEmbeddingContent(product, taxonomyNode, null, {
      qualityLevel: product.qualityLevel,
    });

    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM prod_embeddings 
       WHERE product_id = $1 
         AND variant_id IS NULL 
         AND quality_level = $2 
         AND content_hash = $3`,
      [product.id, product.qualityLevel, buildResult.hash]
    );

    const row = result.rows[0];
    return parseInt(row?.count ?? '0', 10) === 0;
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Calculate simple Jaccard similarity between two strings
 */
function calculateSimpleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
}

// ============================================
// Factory Function
// ============================================

/**
 * Create an instance of EmbeddingContentBuilderService
 */
export function createEmbeddingContentBuilderService(
  config?: Partial<ContentBuilderServiceConfig>,
  logger?: Logger
): EmbeddingContentBuilderService {
  return new EmbeddingContentBuilderService(config, logger);
}
