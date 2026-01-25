/**
 * Embedding Types
 *
 * PR-047: F6.1.1-F6.1.2 - Embeddings Schema & Content Builder
 *
 * TypeScript type definitions for embedding content generation.
 */

import type { ChapterName } from './embedding-constants.js';

// ============================================
// Quality Levels
// ============================================

/**
 * Quality level for embeddings, aligned with prod_master.data_quality_level
 */
export type QualityLevel = 'bronze' | 'silver' | 'golden' | 'review_needed';

/**
 * All valid quality levels
 */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
  'bronze',
  'silver',
  'golden',
  'review_needed',
] as const;

// ============================================
// Embedding Payload
// ============================================

/**
 * Result of building embedding content
 */
export interface EmbeddingPayload {
  /** The full text content for embedding */
  readonly content: string;

  /** SHA-256 hash of the content for change detection */
  readonly hash: string;

  /** Model used for embedding (e.g., 'text-embedding-3-large') */
  readonly model: string;

  /** Language of the content */
  readonly lang: 'ro';

  /** List of field names included in the content */
  readonly fieldsIncluded: readonly string[];

  /** Quality level used for building */
  readonly qualityLevel: QualityLevel;

  /** Number of characters in the content */
  readonly contentLength: number;

  /** Number of chapters included */
  readonly chaptersIncluded: number;
}

/**
 * Result of building embedding content including build metadata
 */
export interface EmbeddingBuildResult extends EmbeddingPayload {
  /** Timestamp when the content was built */
  readonly builtAt: Date;

  /** Version of the builder algorithm */
  readonly builderVersion: string;

  /** Whether variant-specific content was included */
  readonly hasVariantContent: boolean;

  /** Taxonomy path used (if any) */
  readonly taxonomyPath: string | null;
}

// ============================================
// Chapter Content
// ============================================

/**
 * Represents a single chapter of content
 */
export interface ChapterContent {
  /** Chapter name in Romanian */
  readonly name: ChapterName;

  /** Chapter content text */
  readonly content: string;

  /** Display order (lower = first) */
  readonly order: number;

  /** Source of the content */
  readonly source: 'shopify' | 'vendor' | 'ai' | 'manual';
}

/**
 * Collection of chapters for a product
 */
export interface ProductChapters {
  /** Product ID */
  readonly productId: string;

  /** Variant ID (if variant-specific) */
  readonly variantId: string | null;

  /** Array of chapters */
  readonly chapters: readonly ChapterContent[];

  /** Total character count across all chapters */
  readonly totalLength: number;
}

// ============================================
// Product Input Types
// ============================================

/**
 * Product data required for embedding content building
 */
export interface ProductInput {
  /** Product ID (UUID) */
  readonly id: string;

  /** Canonical title */
  readonly title: string;

  /** Brand name */
  readonly brand: string | null;

  /** Manufacturer name */
  readonly manufacturer: string | null;

  /** Manufacturer part number */
  readonly mpn: string | null;

  /** Global Trade Item Number */
  readonly gtin: string | null;

  /** Internal SKU */
  readonly sku: string | null;

  /** Vendor/supplier name */
  readonly vendor: string | null;

  /** Product type */
  readonly productType: string | null;

  /** HTML description (will be cleaned) */
  readonly descriptionHtml: string | null;

  /** Plain text description */
  readonly description: string | null;

  /** Tags array */
  readonly tags: readonly string[];

  /** Normalized specs from PIM */
  readonly specs: Record<string, SpecValue> | null;

  /** Raw specs before normalization */
  readonly rawSpecs: Record<string, unknown> | null;

  /** Selected metafields for embedding */
  readonly metafields: Record<string, string> | null;

  /** Current data quality level */
  readonly qualityLevel: QualityLevel;

  /** Images for variant differentiation */
  readonly imageUrls: readonly string[];
}

/**
 * Variant data for variant-specific embeddings
 */
export interface VariantInput {
  /** Variant ID (UUID) */
  readonly id: string;

  /** Variant title */
  readonly title: string;

  /** Variant SKU */
  readonly sku: string | null;

  /** Variant barcode */
  readonly barcode: string | null;

  /** Selected options (e.g., {Color: 'Red', Size: 'L'}) */
  readonly selectedOptions: Record<string, string>;

  /** Variant-specific specs (if different from product) */
  readonly specs: Record<string, SpecValue> | null;

  /** Variant-specific description */
  readonly description: string | null;

  /** Variant images */
  readonly imageUrls: readonly string[];
}

/**
 * Normalized spec value
 */
export interface SpecValue {
  /** The value */
  readonly value: string | number | boolean;

  /** Unit of measurement (if applicable) */
  readonly unit: string | null;

  /** Original raw value before normalization */
  readonly rawValue?: unknown;
}

// ============================================
// Taxonomy Types
// ============================================

/**
 * Taxonomy node for building taxonomy path
 */
export interface TaxonomyNode {
  /** Taxonomy ID */
  readonly id: string;

  /** Taxonomy name */
  readonly name: string;

  /** URL-safe slug */
  readonly slug: string;

  /** Breadcrumbs path */
  readonly breadcrumbs: readonly string[];

  /** Nesting level (0 = root) */
  readonly level: number;

  /** Shopify taxonomy ID (if mapped) */
  readonly shopifyTaxonomyId: string | null;
}

// ============================================
// Material Difference Configuration
// ============================================

/**
 * Configuration for determining if a variant is "materially different"
 * and should have its own embedding
 */
export interface MaterialDifferenceConfig {
  /** Check for different specs */
  readonly checkSpecs: boolean;

  /** Check for different images */
  readonly checkImages: boolean;

  /** Check for different descriptions */
  readonly checkDescriptions: boolean;

  /** Specific spec keys that indicate material difference */
  readonly specKeys: readonly string[];

  /** Minimum number of different images to trigger */
  readonly minImageDiff: number;

  /** Minimum description length difference to trigger */
  readonly minDescriptionLengthDiff: number;
}

/**
 * Default material difference configuration
 */
export const DEFAULT_MATERIAL_DIFFERENCE_CONFIG: MaterialDifferenceConfig = {
  checkSpecs: true,
  checkImages: true,
  checkDescriptions: true,
  specKeys: ['capacity', 'power', 'voltage', 'dimensions', 'weight', 'material', 'color', 'size'],
  minImageDiff: 2,
  minDescriptionLengthDiff: 100,
} as const;

// ============================================
// Builder Options
// ============================================

/**
 * Options for the embedding content builder
 */
export interface EmbeddingBuilderOptions {
  /** Quality level to use for chapter selection */
  readonly qualityLevel: QualityLevel;

  /** Whether to include variant-specific content */
  readonly includeVariantContent: boolean;

  /** Maximum content length (characters) */
  readonly maxContentLength: number;

  /** Whether to normalize whitespace */
  readonly normalizeWhitespace: boolean;

  /** Whether to strip HTML tags */
  readonly stripHtml: boolean;

  /** Whether to lowercase for consistency */
  readonly lowercaseIdentifiers: boolean;

  /** Custom chapter order (overrides taxonomy-based) */
  readonly customChapterOrder: readonly ChapterName[] | null;
}

/**
 * Default builder options
 */
export const DEFAULT_BUILDER_OPTIONS: EmbeddingBuilderOptions = {
  qualityLevel: 'bronze',
  includeVariantContent: true,
  maxContentLength: 8000,
  normalizeWhitespace: true,
  stripHtml: true,
  lowercaseIdentifiers: false,
  customChapterOrder: null,
} as const;

// ============================================
// Database Types
// ============================================

/**
 * Embedding source types
 */
export type EmbeddingSource = 'shopify' | 'vendor' | 'ai' | 'manual';

/**
 * Embedding record for database persistence
 */
export interface EmbeddingRecord {
  /** Record ID */
  readonly id: string;

  /** Product ID (FK to prod_master) */
  readonly productId: string;

  /** Variant ID (FK to shopify_variants, nullable) */
  readonly variantId: string | null;

  /** The embedding vector (2000 dimensions for HNSW compatibility) */
  readonly embedding: readonly number[];

  /** Quality level */
  readonly qualityLevel: QualityLevel;

  /** Source of the content */
  readonly source: EmbeddingSource;

  /** Model used */
  readonly model: string;

  /** Language */
  readonly lang: 'ro';

  /** Content hash for change detection */
  readonly contentHash: string;

  /** Vector dimensions */
  readonly dimensions: number;

  /** Created timestamp */
  readonly createdAt: Date;

  /** Updated timestamp */
  readonly updatedAt: Date;
}

/**
 * Pending embedding record (before vector generation)
 */
export interface PendingEmbeddingRecord {
  /** Record ID */
  readonly id: string;

  /** Product ID */
  readonly productId: string;

  /** Variant ID (nullable) */
  readonly variantId: string | null;

  /** Quality level */
  readonly qualityLevel: QualityLevel;

  /** Source */
  readonly source: EmbeddingSource;

  /** Content to embed */
  readonly content: string;

  /** Content hash */
  readonly contentHash: string;

  /** Model to use */
  readonly model: string;

  /** Status */
  readonly status: 'pending' | 'processing' | 'failed';

  /** Error message if failed */
  readonly errorMessage: string | null;

  /** Created timestamp */
  readonly createdAt: Date;
}
