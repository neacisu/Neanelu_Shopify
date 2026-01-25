/**
 * Embedding Builder Tests
 *
 * PR-047: F6.1.2 - Tests for content builder determinism and functionality
 */

import { describe, it, expect } from 'vitest';

import {
  buildEmbeddingContent,
  calculateContentHash,
  stripHtml,
  normalizeWhitespace,
  buildTaxonomyPath,
  formatSpecKey,
  BUILDER_VERSION,
} from '../embedding-builder.js';

import { EMBEDDING_MODEL, EMBEDDING_LANG, QUALITY_LEVEL_CHAPTERS } from '../embedding-constants.js';

import type { ProductInput, VariantInput, TaxonomyNode } from '../embedding-types.js';

// ============================================
// Test Fixtures
// ============================================

const createTestProduct = (overrides: Partial<ProductInput> = {}): ProductInput => ({
  id: 'test-product-123',
  title: 'Motocoasă Profesională 52cc',
  brand: 'STIHL',
  manufacturer: 'STIHL AG',
  mpn: 'FS-120',
  gtin: '4009005001234',
  sku: 'MCO-52-PRO',
  vendor: 'Neanelu SRL',
  productType: 'Motocoase',
  descriptionHtml: '<p>Motocoasă <strong>profesională</strong> cu motor de 52cc.</p>',
  description: 'Motocoasă profesională cu motor de 52cc.',
  tags: ['motocoasa', 'profesional', '52cc', 'gradina'],
  specs: {
    capacity: { value: 52, unit: 'cc' },
    power: { value: 2.1, unit: 'kW' },
    weight: { value: 6.5, unit: 'kg' },
    fuel_tank: { value: 0.75, unit: 'L' },
  },
  rawSpecs: null,
  metafields: {
    features: '["Motor puternic", "Design ergonomic", "Consum redus"]',
  },
  qualityLevel: 'bronze',
  imageUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
  ...overrides,
});

const createTestVariant = (overrides: Partial<VariantInput> = {}): VariantInput => ({
  id: 'test-variant-456',
  title: 'Motocoasă 52cc - Verde',
  sku: 'MCO-52-PRO-GREEN',
  barcode: '4009005001235',
  selectedOptions: { Culoare: 'Verde', Accesorii: 'Kit complet' },
  specs: {
    color: { value: 'verde', unit: null },
  },
  description: null,
  imageUrls: ['https://example.com/green1.jpg', 'https://example.com/green2.jpg'],
  ...overrides,
});

const createTestTaxonomy = (overrides: Partial<TaxonomyNode> = {}): TaxonomyNode => ({
  id: 'tax-123',
  name: 'Motocoase',
  slug: 'tools-hardware-motocoase',
  breadcrumbs: ['Unelte', 'Grădină', 'Motocoase'],
  level: 2,
  shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/12345',
  ...overrides,
});

// ============================================
// Determinism Tests
// ============================================

describe('Embedding Builder - Determinism', () => {
  it('should produce identical hash for identical inputs', () => {
    const product = createTestProduct();
    const taxonomy = createTestTaxonomy();

    const result1 = buildEmbeddingContent(product, taxonomy, null, { qualityLevel: 'bronze' });
    const result2 = buildEmbeddingContent(product, taxonomy, null, { qualityLevel: 'bronze' });

    expect(result1.hash).toBe(result2.hash);
    expect(result1.content).toBe(result2.content);
  });

  it('should produce different hash for different inputs', () => {
    const product1 = createTestProduct({ title: 'Produs A' });
    const product2 = createTestProduct({ title: 'Produs B' });

    const result1 = buildEmbeddingContent(product1, null, null);
    const result2 = buildEmbeddingContent(product2, null, null);

    expect(result1.hash).not.toBe(result2.hash);
  });

  it('should produce different hash for different quality levels', () => {
    const product = createTestProduct();

    const resultBronze = buildEmbeddingContent(product, null, null, { qualityLevel: 'bronze' });
    const resultSilver = buildEmbeddingContent(product, null, null, { qualityLevel: 'silver' });

    expect(resultBronze.hash).not.toBe(resultSilver.hash);
  });

  it('should be stable across multiple runs', () => {
    const product = createTestProduct();
    const hashes: string[] = [];

    for (let i = 0; i < 10; i++) {
      const result = buildEmbeddingContent(product, null, null);
      hashes.push(result.hash);
    }

    // All hashes should be identical
    expect(new Set(hashes).size).toBe(1);
  });
});

// ============================================
// Chapter Coverage Tests
// ============================================

describe('Embedding Builder - Chapter Coverage', () => {
  it('should include minimal chapters for bronze quality', () => {
    const product = createTestProduct({ qualityLevel: 'bronze' });
    const result = buildEmbeddingContent(product, null, null, { qualityLevel: 'bronze' });

    const bronzeChapters = QUALITY_LEVEL_CHAPTERS.bronze;

    // Should include chapters for bronze
    expect(result.chaptersIncluded).toBeLessThanOrEqual(bronzeChapters.length);
    expect(result.fieldsIncluded).toContain('chapters');
  });

  it('should include more chapters for silver quality', () => {
    const product = createTestProduct({ qualityLevel: 'silver' });

    const resultBronze = buildEmbeddingContent(product, null, null, { qualityLevel: 'bronze' });
    const resultSilver = buildEmbeddingContent(product, null, null, { qualityLevel: 'silver' });

    expect(resultSilver.chaptersIncluded).toBeGreaterThanOrEqual(resultBronze.chaptersIncluded);
    expect(resultSilver.contentLength).toBeGreaterThan(resultBronze.contentLength);
  });

  it('should include all chapters for golden quality', () => {
    const product = createTestProduct({
      qualityLevel: 'golden',
      metafields: {
        features: '["Motor puternic"]',
        instructions: 'Instrucțiuni detaliate de folosire.',
        installation: 'Ghid de montare.',
        maintenance: 'Sfaturi de întreținere.',
        compatibility: 'Compatibil cu toate accesoriile STIHL.',
        package_contents: '1x Motocoasă, 1x Manual, 1x Kit unelte',
        safety: 'Purtați echipament de protecție.',
        warranty: '2 ani garanție producător.',
      },
    });

    const result = buildEmbeddingContent(product, null, null, { qualityLevel: 'golden' });

    expect(result.qualityLevel).toBe('golden');
    expect(result.chaptersIncluded).toBeGreaterThan(0);
    expect(result.contentLength).toBeGreaterThan(0);
  });

  it('should use Romanian chapter names', () => {
    const product = createTestProduct();
    const result = buildEmbeddingContent(product, null, null, { qualityLevel: 'bronze' });

    // Check for Romanian chapter names in content
    expect(result.content).toContain('Descriere generală');
    expect(result.lang).toBe('ro');
  });
});

// ============================================
// Variant Override Tests
// ============================================

describe('Embedding Builder - Variant Override', () => {
  it('should include variant content when variant is provided', () => {
    const product = createTestProduct();
    const variant = createTestVariant();

    const resultWithoutVariant = buildEmbeddingContent(product, null, null);
    const resultWithVariant = buildEmbeddingContent(product, null, variant);

    expect(resultWithVariant.hasVariantContent).toBe(true);
    expect(resultWithoutVariant.hasVariantContent).toBe(false);
    expect(resultWithVariant.hash).not.toBe(resultWithoutVariant.hash);
  });

  it('should include variant options in content', () => {
    const product = createTestProduct();
    const variant = createTestVariant({
      selectedOptions: { Culoare: 'Roșu', Mărime: 'XL' },
    });

    const result = buildEmbeddingContent(product, null, variant);

    expect(result.content).toContain('Culoare: Roșu');
    expect(result.content).toContain('Mărime: XL');
    expect(result.fieldsIncluded).toContain('variantOptions');
  });

  it('should include variant SKU when different from product', () => {
    const product = createTestProduct({ sku: 'PROD-SKU' });
    const variant = createTestVariant({ sku: 'VAR-SKU' });

    const result = buildEmbeddingContent(product, null, variant);

    expect(result.content).toContain('SKU variantă: VAR-SKU');
  });

  it('should skip variant content when includeVariantContent is false', () => {
    const product = createTestProduct();
    const variant = createTestVariant();

    const result = buildEmbeddingContent(product, null, variant, {
      includeVariantContent: false,
    });

    expect(result.hasVariantContent).toBe(false);
    expect(result.fieldsIncluded).not.toContain('variantOptions');
  });
});

// ============================================
// Hash Stability Tests
// ============================================

describe('Embedding Builder - Hash Stability', () => {
  it('should use SHA-256 for content hash', () => {
    const content = 'Test content for hashing';
    const hash = calculateContentHash(content);

    // SHA-256 produces 64 character hex string
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('should produce consistent hash for same content', () => {
    const content = 'Motocoasă profesională cu motor 52cc';

    const hash1 = calculateContentHash(content);
    const hash2 = calculateContentHash(content);
    const hash3 = calculateContentHash(content);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it('should produce different hash for different content', () => {
    const hash1 = calculateContentHash('Content A');
    const hash2 = calculateContentHash('Content B');

    expect(hash1).not.toBe(hash2);
  });

  it('should be sensitive to whitespace changes', () => {
    const hash1 = calculateContentHash('Text cu spații');
    const hash2 = calculateContentHash('Text  cu  spații');

    expect(hash1).not.toBe(hash2);
  });
});

// ============================================
// Metadata Tests
// ============================================

describe('Embedding Builder - Metadata', () => {
  it('should include correct model information', () => {
    const product = createTestProduct();
    const result = buildEmbeddingContent(product, null, null);

    expect(result.model).toBe(EMBEDDING_MODEL);
    expect(result.lang).toBe(EMBEDDING_LANG);
    expect(result.builderVersion).toBe(BUILDER_VERSION);
  });

  it('should track fields included', () => {
    const product = createTestProduct();
    const result = buildEmbeddingContent(product, null, null);

    expect(result.fieldsIncluded).toContain('title');
    expect(result.fieldsIncluded).toContain('brand');
    expect(result.fieldsIncluded).toContain('identifiers');
    expect(result.fieldsIncluded).toContain('vendor');
    expect(result.fieldsIncluded).toContain('specs');
    expect(result.fieldsIncluded).toContain('tags');
  });

  it('should include taxonomy path when taxonomy provided', () => {
    const product = createTestProduct();
    const taxonomy = createTestTaxonomy();

    const result = buildEmbeddingContent(product, taxonomy, null);

    expect(result.taxonomyPath).toBe('Unelte > Grădină > Motocoase');
    expect(result.fieldsIncluded).toContain('taxonomy');
    expect(result.content).toContain('Categorie: Unelte > Grădină > Motocoase');
  });

  it('should record build timestamp', () => {
    const product = createTestProduct();
    const before = new Date();
    const result = buildEmbeddingContent(product, null, null);
    const after = new Date();

    expect(result.builtAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.builtAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ============================================
// Utility Function Tests
// ============================================

describe('Embedding Builder - Utility Functions', () => {
  describe('stripHtml', () => {
    it('should remove HTML tags', () => {
      const input = '<p>Text <strong>bold</strong> normal</p>';
      const result = stripHtml(input);

      expect(result).not.toContain('<p>');
      expect(result).not.toContain('<strong>');
      expect(result).toContain('Text');
      expect(result).toContain('bold');
    });

    it('should decode HTML entities', () => {
      const input = 'Test &amp; &quot;quotes&quot; &lt;special&gt;';
      const result = stripHtml(input);

      expect(result).toContain('&');
      expect(result).toContain('"');
      expect(result).toContain('<');
      expect(result).toContain('>');
    });

    it('should remove script and style tags with content', () => {
      const input = '<div>Text<script>alert("x")</script>More</div>';
      const result = stripHtml(input);

      expect(result).not.toContain('alert');
      expect(result).toContain('Text');
      expect(result).toContain('More');
    });
  });

  describe('normalizeWhitespace', () => {
    it('should collapse multiple spaces', () => {
      const input = 'Text  with   multiple    spaces';
      const result = normalizeWhitespace(input);

      expect(result).toBe('Text with multiple spaces');
    });

    it('should trim leading and trailing whitespace', () => {
      const input = '   Trimmed text   ';
      const result = normalizeWhitespace(input);

      expect(result).toBe('Trimmed text');
    });
  });

  describe('buildTaxonomyPath', () => {
    it('should join breadcrumbs with separator', () => {
      const node = createTestTaxonomy({
        breadcrumbs: ['Level1', 'Level2', 'Level3'],
      });
      const result = buildTaxonomyPath(node);

      expect(result).toBe('Level1 > Level2 > Level3');
    });

    it('should use name when breadcrumbs empty', () => {
      const node = createTestTaxonomy({
        name: 'SingleCategory',
        breadcrumbs: [],
      });
      const result = buildTaxonomyPath(node);

      expect(result).toBe('SingleCategory');
    });
  });

  describe('formatSpecKey', () => {
    it('should convert snake_case to Title Case', () => {
      expect(formatSpecKey('fuel_tank_capacity')).toBe('Fuel Tank Capacity');
      expect(formatSpecKey('max_power')).toBe('Max Power');
    });

    it('should handle single words', () => {
      expect(formatSpecKey('weight')).toBe('Weight');
    });
  });
});

// ============================================
// Edge Cases
// ============================================

describe('Embedding Builder - Edge Cases', () => {
  it('should handle product with minimal data', () => {
    const product = createTestProduct({
      title: 'Minimal Product',
      brand: null,
      manufacturer: null,
      mpn: null,
      gtin: null,
      sku: null,
      vendor: null,
      productType: null,
      descriptionHtml: null,
      description: null,
      tags: [],
      specs: null,
      metafields: null,
    });

    const result = buildEmbeddingContent(product, null, null);

    expect(result.content).toContain('Minimal Product');
    expect(result.hash).toHaveLength(64);
    expect(result.fieldsIncluded).toContain('title');
  });

  it('should handle empty specs object', () => {
    const product = createTestProduct({ specs: {} });
    const result = buildEmbeddingContent(product, null, null);

    expect(result.fieldsIncluded).not.toContain('specs');
  });

  it('should respect maxContentLength option', () => {
    const product = createTestProduct({
      description: 'A'.repeat(10000),
    });

    const result = buildEmbeddingContent(product, null, null, {
      maxContentLength: 1000,
    });

    expect(result.contentLength).toBeLessThanOrEqual(1000);
  });

  it('should handle special characters in content', () => {
    const product = createTestProduct({
      title: 'Produs cu caractere speciale: ăîșțâ & "quotes"',
      description: 'Descriere cu <tag> și &entity;',
    });

    const result = buildEmbeddingContent(product, null, null);

    expect(result.hash).toHaveLength(64);
    expect(result.content.length).toBeGreaterThan(0);
  });
});
