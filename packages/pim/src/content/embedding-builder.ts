/**
 * Embedding Builder
 *
 * PR-047: F6.1.2 - Content builder + canonicalizare + content_hash (deterministic)
 *
 * Builds deterministic embedding content for PIM products with:
 * - Romanian-only chapter-based content structure
 * - Quality level enrichment stages (bronze/silver/golden)
 * - SHA-256 content hashing for change detection
 * - Taxonomy-based chapter ordering
 */

import { createHash } from 'node:crypto';

import {
  EMBEDDING_MODEL,
  EMBEDDING_LANG,
  QUALITY_LEVEL_CHAPTERS,
  TAXONOMY_CHAPTER_TEMPLATES,
  SECTION_SEPARATOR,
  FIELD_SEPARATOR,
  TAXONOMY_PATH_SEPARATOR,
  VARIANT_OPTION_SEPARATOR,
  IDENTIFIER_PREFIXES,
  ALL_CHAPTERS,
  type ChapterName,
} from './embedding-constants.js';

import {
  type QualityLevel,
  type ProductInput,
  type VariantInput,
  type TaxonomyNode,
  type EmbeddingPayload,
  type EmbeddingBuildResult,
  type ChapterContent,
  type EmbeddingBuilderOptions,
  DEFAULT_BUILDER_OPTIONS,
} from './embedding-types.js';

// ============================================
// Builder Version
// ============================================

/** Current builder algorithm version */
export const BUILDER_VERSION = '1.0.0';

// ============================================
// Main Builder Function
// ============================================

/**
 * Build deterministic embedding content for a product.
 *
 * Content structure:
 * 1. Title (weighted x3)
 * 2. Brand (weighted x2)
 * 3. Taxonomy path in Romanian (weighted x2)
 * 4. Identifiers: GTIN, MPN, SKU
 * 5. Vendor
 * 6. Key specs (weighted x2)
 * 7. Variant options (if variant provided)
 * 8. Chapterized descriptions (based on quality level)
 *
 * @param product - Product data input
 * @param taxonomyNode - Taxonomy node for path normalization (optional)
 * @param variant - Variant data for variant-specific embeddings (optional)
 * @param options - Builder options (defaults to bronze quality)
 * @returns EmbeddingBuildResult with content, hash, and metadata
 */
export function buildEmbeddingContent(
  product: ProductInput,
  taxonomyNode: TaxonomyNode | null = null,
  variant: VariantInput | null = null,
  options: Partial<EmbeddingBuilderOptions> = {}
): EmbeddingBuildResult {
  const opts: EmbeddingBuilderOptions = { ...DEFAULT_BUILDER_OPTIONS, ...options };
  const fieldsIncluded: string[] = [];
  const sections: string[] = [];

  // 1. Title (always included, weighted)
  const title = normalizeText(product.title, opts);
  if (title) {
    sections.push(repeatForWeight(title, 3));
    fieldsIncluded.push('title');
  }

  // 2. Brand (weighted x2)
  if (product.brand) {
    const brand = normalizeText(product.brand, opts);
    if (brand) {
      sections.push(repeatForWeight(`Marcă: ${brand}`, 2));
      fieldsIncluded.push('brand');
    }
  }

  // 3. Taxonomy path in Romanian
  if (taxonomyNode) {
    const taxonomyPath = buildTaxonomyPath(taxonomyNode);
    if (taxonomyPath) {
      sections.push(repeatForWeight(`Categorie: ${taxonomyPath}`, 2));
      fieldsIncluded.push('taxonomy');
    }
  }

  // 4. Identifiers
  const identifiers = buildIdentifiersSection(product, variant);
  if (identifiers) {
    sections.push(identifiers);
    fieldsIncluded.push('identifiers');
  }

  // 5. Vendor
  if (product.vendor) {
    const vendor = normalizeText(product.vendor, opts);
    if (vendor) {
      sections.push(`Furnizor: ${vendor}`);
      fieldsIncluded.push('vendor');
    }
  }

  // 6. Product type
  if (product.productType) {
    const productType = normalizeText(product.productType, opts);
    if (productType) {
      sections.push(`Tip produs: ${productType}`);
      fieldsIncluded.push('productType');
    }
  }

  // 7. Key specs (based on quality level)
  const specsSection = buildSpecsSection(product, variant, opts.qualityLevel);
  if (specsSection) {
    sections.push(repeatForWeight(specsSection, 2));
    fieldsIncluded.push('specs');
  }

  // 8. Variant options (if variant provided and includeVariantContent is true)
  if (variant && opts.includeVariantContent) {
    const variantSection = buildVariantSection(variant);
    if (variantSection) {
      sections.push(variantSection);
      fieldsIncluded.push('variantOptions');
    }
  }

  // 9. Tags
  if (product.tags.length > 0) {
    const tagsSection = `Etichete: ${product.tags.join(', ')}`;
    sections.push(tagsSection);
    fieldsIncluded.push('tags');
  }

  // 10. Chapterized descriptions (based on quality level)
  const chapters = buildChaptersSection(
    product,
    taxonomyNode,
    opts.qualityLevel,
    opts.customChapterOrder
  );
  if (chapters.length > 0) {
    const chaptersText = chapters
      .map((ch) => `## ${ch.name}\n${ch.content}`)
      .join(SECTION_SEPARATOR);
    sections.push(repeatForWeight(chaptersText, 2));
    fieldsIncluded.push('chapters');
  }

  // Join all sections
  let content = sections.join(SECTION_SEPARATOR);

  // Normalize whitespace if enabled
  if (opts.normalizeWhitespace) {
    content = normalizeWhitespace(content);
  }

  // Truncate if exceeds max length
  if (content.length > opts.maxContentLength) {
    content = content.slice(0, opts.maxContentLength);
  }

  // Calculate deterministic hash
  const hash = calculateContentHash(content);

  const payload: EmbeddingPayload = {
    content,
    hash,
    model: EMBEDDING_MODEL,
    lang: EMBEDDING_LANG,
    fieldsIncluded,
    qualityLevel: opts.qualityLevel,
    contentLength: content.length,
    chaptersIncluded: chapters.length,
  };

  return {
    ...payload,
    builtAt: new Date(),
    builderVersion: BUILDER_VERSION,
    hasVariantContent: variant !== null && opts.includeVariantContent,
    taxonomyPath: taxonomyNode ? buildTaxonomyPath(taxonomyNode) : null,
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Normalize text: trim, optionally strip HTML, normalize whitespace
 */
function normalizeText(text: string, opts: EmbeddingBuilderOptions): string {
  let result = text.trim();

  if (opts.stripHtml) {
    result = stripHtml(result);
  }

  if (opts.normalizeWhitespace) {
    result = normalizeWhitespace(result);
  }

  return result;
}

/**
 * Strip HTML tags from text
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ');
}

/**
 * Normalize whitespace: collapse multiple spaces/newlines
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * Repeat text for weighting (simple repetition strategy)
 */
function repeatForWeight(text: string, weight: number): string {
  if (weight <= 1) return text;
  // For weights > 1, we repeat the text to increase its influence
  // But we limit to avoid excessive content
  const repeats = Math.min(weight, 3);
  return Array(repeats).fill(text).join(' ');
}

/**
 * Build taxonomy path from breadcrumbs
 */
function buildTaxonomyPath(node: TaxonomyNode): string {
  if (node.breadcrumbs.length > 0) {
    return node.breadcrumbs.join(TAXONOMY_PATH_SEPARATOR);
  }
  return node.name;
}

/**
 * Build identifiers section
 */
function buildIdentifiersSection(
  product: ProductInput,
  variant: VariantInput | null
): string | null {
  const parts: string[] = [];

  if (product.gtin) {
    parts.push(`${IDENTIFIER_PREFIXES.gtin}: ${product.gtin}`);
  }
  if (product.mpn) {
    parts.push(`${IDENTIFIER_PREFIXES.mpn}: ${product.mpn}`);
  }
  if (product.sku) {
    parts.push(`${IDENTIFIER_PREFIXES.sku}: ${product.sku}`);
  }
  if (variant?.sku && variant.sku !== product.sku) {
    parts.push(`${IDENTIFIER_PREFIXES.sku} variantă: ${variant.sku}`);
  }
  if (variant?.barcode) {
    parts.push(`${IDENTIFIER_PREFIXES.barcode}: ${variant.barcode}`);
  }

  return parts.length > 0 ? parts.join(FIELD_SEPARATOR) : null;
}

/**
 * Build specs section based on quality level
 */
function buildSpecsSection(
  product: ProductInput,
  variant: VariantInput | null,
  qualityLevel: QualityLevel
): string | null {
  const specs = { ...(product.specs ?? {}), ...(variant?.specs ?? {}) };
  const entries = Object.entries(specs);

  if (entries.length === 0) return null;

  // For bronze, limit to key specs
  const maxSpecs = qualityLevel === 'bronze' ? 10 : qualityLevel === 'silver' ? 20 : entries.length;
  const selectedEntries = entries.slice(0, maxSpecs);

  const specLines = selectedEntries.map(([key, value]) => {
    const displayValue =
      typeof value.value === 'boolean' ? (value.value ? 'Da' : 'Nu') : String(value.value);
    const unit = value.unit ? ` ${value.unit}` : '';
    return `${formatSpecKey(key)}: ${displayValue}${unit}`;
  });

  return `Specificații:\n${specLines.join('\n')}`;
}

/**
 * Format spec key for display (convert snake_case to Title Case)
 */
function formatSpecKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build variant section
 */
function buildVariantSection(variant: VariantInput): string | null {
  const options = Object.entries(variant.selectedOptions);
  if (options.length === 0) return null;

  const optionText = options
    .map(([name, value]) => `${name}: ${value}`)
    .join(VARIANT_OPTION_SEPARATOR);

  return `Opțiuni variantă: ${optionText}`;
}

/**
 * Build chapters section based on quality level and taxonomy
 */
function buildChaptersSection(
  product: ProductInput,
  taxonomyNode: TaxonomyNode | null,
  qualityLevel: QualityLevel,
  customChapterOrder: readonly ChapterName[] | null
): ChapterContent[] {
  // Determine which chapters to include
  const allowedChapters = QUALITY_LEVEL_CHAPTERS[qualityLevel];

  // Determine chapter order
  let chapterOrder: readonly ChapterName[];
  if (customChapterOrder) {
    chapterOrder = customChapterOrder;
  } else if (taxonomyNode) {
    chapterOrder = getChapterOrderForTaxonomy(taxonomyNode.slug);
  } else {
    chapterOrder = ALL_CHAPTERS;
  }

  // Filter to only allowed chapters for this quality level
  const orderedChapters = chapterOrder.filter((ch) =>
    (allowedChapters as readonly string[]).includes(ch)
  );

  // Build chapter content
  const chapters: ChapterContent[] = [];
  let order = 0;

  for (const chapterName of orderedChapters) {
    const content = getChapterContent(product, chapterName, qualityLevel);
    if (content) {
      chapters.push({
        name: chapterName,
        content,
        order: order++,
        source: determineContentSource(product, chapterName),
      });
    }
  }

  return chapters;
}

/**
 * Get chapter order for a taxonomy slug
 */
function getChapterOrderForTaxonomy(taxonomySlug: string): readonly ChapterName[] {
  // Find matching template
  const template = TAXONOMY_CHAPTER_TEMPLATES.find(
    (t) => taxonomySlug.includes(t.taxonomySlug) && t.taxonomySlug !== 'default'
  );

  return template?.chapters ?? ALL_CHAPTERS;
}

/**
 * Get content for a specific chapter
 */
function getChapterContent(
  product: ProductInput,
  chapterName: ChapterName,
  qualityLevel: QualityLevel
): string | null {
  switch (chapterName) {
    case 'Descriere generală':
      return getDescriereGenerala(product, qualityLevel);

    case 'Caracteristici tehnice':
      return getCaracteristiciTehnice(product, qualityLevel);

    case 'Funcționalități':
      return getFeatures(product, qualityLevel);

    case 'Instrucțiuni de folosire':
      return qualityLevel !== 'bronze' ? getInstructiuni(product) : null;

    case 'Montare și instalare':
      return qualityLevel === 'golden' ? getMontare(product) : null;

    case 'Întreținere și curățare':
      return qualityLevel === 'golden' ? getIntretinere(product) : null;

    case 'Compatibilitate':
      return qualityLevel !== 'bronze' ? getCompatibilitate(product) : null;

    case 'Conținut pachet':
      return qualityLevel !== 'bronze' ? getContinutPachet(product) : null;

    case 'Siguranță și avertismente':
      return qualityLevel === 'golden' ? getSiguranta(product) : null;

    case 'Garanție și service':
      return qualityLevel === 'golden' ? getGarantie(product) : null;

    default:
      return null;
  }
}

/**
 * Get general description content
 */
function getDescriereGenerala(product: ProductInput, qualityLevel: QualityLevel): string | null {
  // Use plain text description if available
  if (product.description) {
    return truncateForQuality(product.description, qualityLevel);
  }

  // Fall back to HTML description (will be stripped)
  if (product.descriptionHtml) {
    const plainText = stripHtml(product.descriptionHtml);
    return truncateForQuality(plainText, qualityLevel);
  }

  return null;
}

/**
 * Get technical characteristics content
 */
function getCaracteristiciTehnice(
  product: ProductInput,
  qualityLevel: QualityLevel
): string | null {
  if (!product.specs || Object.keys(product.specs).length === 0) return null;

  const maxSpecs = qualityLevel === 'bronze' ? 5 : qualityLevel === 'silver' ? 15 : 30;
  const entries = Object.entries(product.specs).slice(0, maxSpecs);

  const lines = entries.map(([key, value]) => {
    const displayValue =
      typeof value.value === 'boolean' ? (value.value ? 'Da' : 'Nu') : String(value.value);
    const unit = value.unit ? ` ${value.unit}` : '';
    return `- ${formatSpecKey(key)}: ${displayValue}${unit}`;
  });

  return lines.join('\n');
}

/**
 * Get features content
 */
function getFeatures(product: ProductInput, qualityLevel: QualityLevel): string | null {
  // Extract features from metafields or tags
  const features: string[] = [];

  // Check for features in metafields
  const featuresField = product.metafields?.['features'];
  if (featuresField) {
    try {
      const parsed: unknown = JSON.parse(featuresField);
      if (
        Array.isArray(parsed) &&
        parsed.every((item): item is string => typeof item === 'string')
      ) {
        features.push(...parsed);
      }
    } catch {
      // If not JSON, treat as comma-separated
      features.push(...featuresField.split(',').map((f) => f.trim()));
    }
  }

  // Add relevant tags as features
  const featureTags = product.tags.filter(
    (tag) => !tag.startsWith('_') && !tag.includes(':') && tag.length > 3
  );
  features.push(...featureTags.slice(0, qualityLevel === 'bronze' ? 3 : 10));

  if (features.length === 0) return null;

  const uniqueFeatures = [...new Set(features)];
  const maxFeatures = qualityLevel === 'bronze' ? 5 : qualityLevel === 'silver' ? 10 : 20;

  return uniqueFeatures
    .slice(0, maxFeatures)
    .map((f) => `- ${f}`)
    .join('\n');
}

/**
 * Get usage instructions content
 */
function getInstructiuni(product: ProductInput): string | null {
  return product.metafields?.['instructions'] ?? null;
}

/**
 * Get installation content
 */
function getMontare(product: ProductInput): string | null {
  return product.metafields?.['installation'] ?? null;
}

/**
 * Get maintenance content
 */
function getIntretinere(product: ProductInput): string | null {
  return product.metafields?.['maintenance'] ?? null;
}

/**
 * Get compatibility content
 */
function getCompatibilitate(product: ProductInput): string | null {
  return product.metafields?.['compatibility'] ?? null;
}

/**
 * Get package contents
 */
function getContinutPachet(product: ProductInput): string | null {
  return product.metafields?.['package_contents'] ?? null;
}

/**
 * Get safety warnings
 */
function getSiguranta(product: ProductInput): string | null {
  return product.metafields?.['safety'] ?? null;
}

/**
 * Get warranty info
 */
function getGarantie(product: ProductInput): string | null {
  return product.metafields?.['warranty'] ?? null;
}

/**
 * Truncate content based on quality level
 */
function truncateForQuality(content: string, qualityLevel: QualityLevel): string {
  const maxLength = qualityLevel === 'bronze' ? 500 : qualityLevel === 'silver' ? 1500 : 3000;

  if (content.length <= maxLength) return content;

  // Truncate at word boundary
  const truncated = content.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  return lastSpace > maxLength * 0.8 ? truncated.slice(0, lastSpace) + '...' : truncated + '...';
}

/**
 * Determine the source of content for a chapter
 */
function determineContentSource(
  product: ProductInput,
  _chapterName: ChapterName
): 'shopify' | 'vendor' | 'ai' | 'manual' {
  // Default logic - can be enhanced based on actual data sources
  if (product.qualityLevel === 'golden') return 'ai';
  if (product.qualityLevel === 'silver') return 'vendor';
  return 'shopify';
}

// ============================================
// Hash Calculation
// ============================================

/**
 * Calculate SHA-256 hash of content for change detection.
 * This is deterministic - same content always produces same hash.
 */
export function calculateContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ============================================
// Exports
// ============================================

export { normalizeText, stripHtml, normalizeWhitespace, buildTaxonomyPath, formatSpecKey };
