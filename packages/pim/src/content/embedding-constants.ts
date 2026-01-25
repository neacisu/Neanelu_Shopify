/**
 * Embedding Constants
 *
 * PR-047: F6.1.1-F6.1.2 - Embeddings Schema & Content Builder
 *
 * Defines constants for embedding generation including:
 * - Model configuration (text-embedding-3-large, 3072 dims)
 * - Romanian language settings
 * - Chapter names for structured content
 * - Taxonomy-based template ordering
 */

// ============================================
// Model Configuration
// ============================================

/** OpenAI embedding model name */
export const EMBEDDING_MODEL = 'text-embedding-3-large';

/** Embedding vector dimensions */
export const EMBEDDING_DIM = 3072;

/** Default language for embeddings */
export const EMBEDDING_LANG = 'ro' as const;

// ============================================
// Chapter Names (Romanian)
// ============================================

/**
 * Chapter constants for structured embedding content.
 * These define the semantic sections of product information.
 */
export const CHAPTER_DESCRIERE_GENERALA = 'Descriere generală';
export const CHAPTER_INSTRUCTIUNI_FOLOSIRE = 'Instrucțiuni de folosire';
export const CHAPTER_INTRETINERE = 'Întreținere și curățare';
export const CHAPTER_MONTARE = 'Montare și instalare';
export const CHAPTER_CARACTERISTICI_TEHNICE = 'Caracteristici tehnice';
export const CHAPTER_FEATURES = 'Funcționalități';
export const CHAPTER_COMPATIBILITATE = 'Compatibilitate';
export const CHAPTER_CONTINUT_PACHET = 'Conținut pachet';
export const CHAPTER_GARANTIE = 'Garanție și service';
export const CHAPTER_SIGURANTA = 'Siguranță și avertismente';

/**
 * All available chapters in default order
 */
export const ALL_CHAPTERS = [
  CHAPTER_DESCRIERE_GENERALA,
  CHAPTER_CARACTERISTICI_TEHNICE,
  CHAPTER_FEATURES,
  CHAPTER_INSTRUCTIUNI_FOLOSIRE,
  CHAPTER_MONTARE,
  CHAPTER_INTRETINERE,
  CHAPTER_COMPATIBILITATE,
  CHAPTER_CONTINUT_PACHET,
  CHAPTER_SIGURANTA,
  CHAPTER_GARANTIE,
] as const;

export type ChapterName = (typeof ALL_CHAPTERS)[number];

// ============================================
// Quality Level Chapters
// ============================================

/**
 * Chapters included per quality level.
 * Bronze = minimal, Silver = expanded, Golden = complete
 */
export const QUALITY_LEVEL_CHAPTERS = {
  bronze: [CHAPTER_DESCRIERE_GENERALA, CHAPTER_CARACTERISTICI_TEHNICE] as const,

  silver: [
    CHAPTER_DESCRIERE_GENERALA,
    CHAPTER_CARACTERISTICI_TEHNICE,
    CHAPTER_FEATURES,
    CHAPTER_INSTRUCTIUNI_FOLOSIRE,
    CHAPTER_CONTINUT_PACHET,
  ] as const,

  golden: ALL_CHAPTERS,

  review_needed: [CHAPTER_DESCRIERE_GENERALA, CHAPTER_CARACTERISTICI_TEHNICE] as const,
} as const;

// ============================================
// Taxonomy-based Chapter Templates
// ============================================

/**
 * Template type for taxonomy-specific chapter ordering.
 * Maps taxonomy slugs to ordered chapter arrays.
 */
export interface TaxonomyChapterTemplate {
  readonly taxonomySlug: string;
  readonly chapters: readonly ChapterName[];
  readonly priority: number;
}

/**
 * Default chapter templates per taxonomy category.
 * These define the optimal chapter order for different product types.
 */
export const TAXONOMY_CHAPTER_TEMPLATES: readonly TaxonomyChapterTemplate[] = [
  // Electronics - emphasize technical specs and compatibility
  {
    taxonomySlug: 'electronics',
    chapters: [
      CHAPTER_DESCRIERE_GENERALA,
      CHAPTER_CARACTERISTICI_TEHNICE,
      CHAPTER_COMPATIBILITATE,
      CHAPTER_FEATURES,
      CHAPTER_CONTINUT_PACHET,
      CHAPTER_INSTRUCTIUNI_FOLOSIRE,
      CHAPTER_SIGURANTA,
      CHAPTER_GARANTIE,
    ],
    priority: 100,
  },

  // Home & Garden - emphasize installation and maintenance
  {
    taxonomySlug: 'home-garden',
    chapters: [
      CHAPTER_DESCRIERE_GENERALA,
      CHAPTER_CARACTERISTICI_TEHNICE,
      CHAPTER_MONTARE,
      CHAPTER_INTRETINERE,
      CHAPTER_FEATURES,
      CHAPTER_CONTINUT_PACHET,
      CHAPTER_SIGURANTA,
      CHAPTER_GARANTIE,
    ],
    priority: 90,
  },

  // Tools & Hardware - emphasize usage and safety
  {
    taxonomySlug: 'tools-hardware',
    chapters: [
      CHAPTER_DESCRIERE_GENERALA,
      CHAPTER_CARACTERISTICI_TEHNICE,
      CHAPTER_INSTRUCTIUNI_FOLOSIRE,
      CHAPTER_SIGURANTA,
      CHAPTER_INTRETINERE,
      CHAPTER_FEATURES,
      CHAPTER_CONTINUT_PACHET,
      CHAPTER_GARANTIE,
    ],
    priority: 90,
  },

  // Agriculture - emphasize usage and maintenance
  {
    taxonomySlug: 'agriculture',
    chapters: [
      CHAPTER_DESCRIERE_GENERALA,
      CHAPTER_CARACTERISTICI_TEHNICE,
      CHAPTER_INSTRUCTIUNI_FOLOSIRE,
      CHAPTER_INTRETINERE,
      CHAPTER_COMPATIBILITATE,
      CHAPTER_FEATURES,
      CHAPTER_SIGURANTA,
      CHAPTER_GARANTIE,
    ],
    priority: 90,
  },

  // Automotive Parts - emphasize compatibility
  {
    taxonomySlug: 'automotive',
    chapters: [
      CHAPTER_DESCRIERE_GENERALA,
      CHAPTER_COMPATIBILITATE,
      CHAPTER_CARACTERISTICI_TEHNICE,
      CHAPTER_MONTARE,
      CHAPTER_FEATURES,
      CHAPTER_CONTINUT_PACHET,
      CHAPTER_GARANTIE,
    ],
    priority: 90,
  },

  // Default template for unmatched taxonomies
  {
    taxonomySlug: 'default',
    chapters: ALL_CHAPTERS,
    priority: 0,
  },
] as const;

// ============================================
// Content Field Weights
// ============================================

/**
 * Relative importance of different content fields for embedding.
 * Higher weight = more prominent in final text.
 */
export const CONTENT_FIELD_WEIGHTS = {
  title: 3,
  brand: 2,
  taxonomyPath: 2,
  identifiers: 1,
  vendor: 1,
  specs: 2,
  variantOptions: 1,
  chapters: 2,
} as const;

// ============================================
// Identifier Prefixes (Romanian)
// ============================================

/**
 * Prefixes for product identifiers in embedding text
 */
export const IDENTIFIER_PREFIXES = {
  gtin: 'GTIN',
  mpn: 'Cod producător',
  sku: 'SKU',
  barcode: 'Cod de bare',
} as const;

// ============================================
// Separator Constants
// ============================================

/** Separator between major sections */
export const SECTION_SEPARATOR = '\n\n';

/** Separator between fields within a section */
export const FIELD_SEPARATOR = ' | ';

/** Separator for taxonomy path segments */
export const TAXONOMY_PATH_SEPARATOR = ' > ';

/** Separator for variant options */
export const VARIANT_OPTION_SEPARATOR = ', ';
