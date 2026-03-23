/**
 * node:test: `describe` / `test` returnează promisiuni pe care runner-ul le planifică intern;
 * nu le așteptăm la înregistrare (pattern recomandat de API). Vezi și
 * `src/queue/__tests__/lex-queues-retry-dlq.test.ts`.
 */
/* eslint-disable @typescript-eslint/no-floating-promises */

import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  sha256,
  sha256StableJson,
  normalizeWhitespace,
  normalizeLexeme,
  tokenizeLexText,
  uniqueStrings,
  buildContextWindow,
  parseShardSourceRecordIds,
  parseTouchedIds,
  toNumberOrZero,
  decimalString,
  parseLexShopLangFromSettingsRow,
  tokenOverlapsProtectedSpan,
  buildLocalizationContentHash,
} from '../pipeline-utils.js';

import {
  stripHtml,
  rawTextContainsLikelyHtmlTag,
  shouldPreserveHtmlField,
  canonicalizeText,
  tokenCount,
  normalizeMetafields,
  collectFragmentsFromRow,
  lexAiProducedConfidenceCap,
  estimateTokens,
  clampAiConfidence,
  isNoOpTranslation,
  applyNoOpAndCap,
  shouldEscalateToConsensus,
  mapConsensusMethodToConfidence,
  buildGroupingKey,
  clusterCompositeKey,
  summarizeConfidenceDistribution,
  maybeAppend,
} from '../pipeline-pure-fns.js';
import {
  containsComposeDisallowedControlChars,
  extractHtmlTagNamesFromMarkup,
  buildLexReplacementRulesFromTranslationRows,
} from '../compose-localization-pure.js';

import { applyTranslations } from '../compose-apply-translations.js';

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. EXTRACT-FRAGMENTS – pure helpers
 * ═══════════════════════════════════════════════════════════════════════ */

describe('extract-fragments – stripHtml', () => {
  test('removes simple HTML tags', () => {
    assert.strictEqual(stripHtml('<p>Hello</p>'), ' Hello ');
  });

  test('removes nested tags', () => {
    assert.strictEqual(stripHtml('<div><b>bold</b> text</div>'), '  bold  text ');
  });

  test('leaves plain text unchanged', () => {
    assert.strictEqual(stripHtml('no tags here'), 'no tags here');
  });

  test('handles self-closing tags', () => {
    assert.strictEqual(stripHtml('before<br/>after'), 'before after');
  });

  test('handles empty string', () => {
    assert.strictEqual(stripHtml(''), '');
  });

  test('strips tags with attributes', () => {
    assert.strictEqual(stripHtml('<a href="http://example.com">link</a>'), ' link ');
  });

  test('strips HTML comments before tags', () => {
    assert.strictEqual(stripHtml('<!-- note --><p>x</p>'), '  x ');
  });

  test('strips CDATA sections', () => {
    assert.strictEqual(stripHtml('<![CDATA[<evil>]]>y'), ' y');
  });
});

describe('extract-fragments – rawTextContainsLikelyHtmlTag', () => {
  test('true when angle brackets wrap a segment', () => {
    assert.strictEqual(rawTextContainsLikelyHtmlTag('<b>x</b>'), true);
  });

  test('false without closing bracket', () => {
    assert.strictEqual(rawTextContainsLikelyHtmlTag('a < b'), false);
  });

  test('false for plain text', () => {
    assert.strictEqual(rawTextContainsLikelyHtmlTag('no html'), false);
  });
});

describe('extract-fragments – shouldPreserveHtmlField', () => {
  test('preserves description_html', () => {
    assert.strictEqual(shouldPreserveHtmlField('description_html'), true);
  });

  test('preserves body_html', () => {
    assert.strictEqual(shouldPreserveHtmlField('body_html'), true);
  });

  test('preserves nested .description_html', () => {
    assert.strictEqual(shouldPreserveHtmlField('seo.description_html'), true);
  });

  test('does NOT preserve title', () => {
    assert.strictEqual(shouldPreserveHtmlField('title'), false);
  });

  test('does NOT preserve description (without _html)', () => {
    assert.strictEqual(shouldPreserveHtmlField('description'), false);
  });

  test('does NOT preserve vendor', () => {
    assert.strictEqual(shouldPreserveHtmlField('vendor'), false);
  });
});

describe('extract-fragments – canonicalizeText', () => {
  test('lowercases and collapses whitespace', () => {
    assert.strictEqual(canonicalizeText('  Hello   World  '), 'hello world');
  });

  test('empty string returns empty', () => {
    assert.strictEqual(canonicalizeText(''), '');
  });

  test('tabs and newlines collapsed', () => {
    assert.strictEqual(canonicalizeText('Hello\t\nWorld'), 'hello world');
  });

  test('mixed case normalized', () => {
    assert.strictEqual(canonicalizeText('UPPER lower MiXeD'), 'upper lower mixed');
  });
});

describe('extract-fragments – tokenCount', () => {
  test('counts words', () => {
    assert.strictEqual(tokenCount('one two three'), 3);
  });

  test('collapses whitespace before counting', () => {
    assert.strictEqual(tokenCount('  one   two  '), 2);
  });

  test('empty string returns 0', () => {
    assert.strictEqual(tokenCount(''), 0);
  });

  test('whitespace-only returns 0', () => {
    assert.strictEqual(tokenCount('   '), 0);
  });

  test('single word returns 1', () => {
    assert.strictEqual(tokenCount('word'), 1);
  });
});

describe('extract-fragments – normalizeMetafields', () => {
  test('returns empty array for null', () => {
    assert.deepStrictEqual(normalizeMetafields(null), []);
  });

  test('returns empty array for non-object', () => {
    assert.deepStrictEqual(normalizeMetafields('string'), []);
  });

  test('extracts string metafields', () => {
    const result = normalizeMetafields({ color: 'red', size: 'large' });
    assert.strictEqual(result.length, 2);
    const [first, second] = result;
    assert.ok(first && second);
    assert.strictEqual(first.fieldPath, 'metafields.color');
    assert.strictEqual(first.rawText, 'red');
    assert.strictEqual(second.fieldPath, 'metafields.size');
  });

  test('skips empty strings', () => {
    const result = normalizeMetafields({ color: '', size: 'large' });
    assert.strictEqual(result.length, 1);
    const [only] = result;
    assert.ok(only);
    assert.strictEqual(only.fieldPath, 'metafields.size');
  });

  test('skips whitespace-only strings', () => {
    const result = normalizeMetafields({ color: '   ', size: 'large' });
    assert.strictEqual(result.length, 1);
  });

  test('extracts nested object metafields', () => {
    const result = normalizeMetafields({ specs: { weight: '5kg', height: '10cm' } });
    assert.strictEqual(result.length, 2);
    const [first] = result;
    assert.ok(first);
    assert.strictEqual(first.fieldPath, 'metafields.specs.weight');
    assert.strictEqual(first.rawText, '5kg');
  });

  test('all fragments have fieldKind "metafield"', () => {
    const result = normalizeMetafields({ a: 'val' });
    const [first] = result;
    assert.ok(first);
    assert.strictEqual(first.fieldKind, 'metafield');
  });
});

describe('extract-fragments – collectFragmentsFromRow', () => {
  test('product: extracts title and description', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      title: 'Widget Pro',
      description: 'A great widget',
    };
    const fragments = collectFragmentsFromRow('shopify_products', row);
    const fieldPaths = new Set(fragments.map((f) => f.fieldPath));
    assert.ok(fieldPaths.has('title'));
    assert.ok(fieldPaths.has('description'));
  });

  test('product: skips empty title', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      title: '',
      description: 'desc',
    };
    const fragments = collectFragmentsFromRow('shopify_products', row);
    const fieldPaths = new Set(fragments.map((f) => f.fieldPath));
    assert.ok(!fieldPaths.has('title'));
    assert.ok(fieldPaths.has('description'));
  });

  test('product: extracts tags array', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      tags: ['sale', 'new', 42],
    };
    const fragments = collectFragmentsFromRow('shopify_products', row);
    const tagFragments = fragments.filter((f) => f.fieldPath === 'tags[]');
    assert.strictEqual(tagFragments.length, 2);
  });

  test('product: extracts SEO fields', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      seo: { title: 'SEO title', description: 'SEO desc' },
    };
    const fragments = collectFragmentsFromRow('shopify_products', row);
    const fieldPaths = new Set(fragments.map((f) => f.fieldPath));
    assert.ok(fieldPaths.has('seo.title'));
    assert.ok(fieldPaths.has('seo.description'));
  });

  test('variant: extracts selected_options', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000002',
      product_id: '00000000-0000-0000-0000-000000000001',
      title: 'Red / Large',
      selected_options: [
        { name: 'Color', value: 'Red' },
        { name: 'Size', value: 'Large' },
      ],
    };
    const fragments = collectFragmentsFromRow('shopify_variants', row);
    assert.ok(fragments.some((f) => f.fieldPath === 'selected_options.0.name'));
    assert.ok(fragments.some((f) => f.fieldPath === 'selected_options.0.value'));
  });

  test('collection: extracts title and description', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000003',
      title: 'Summer Sale',
      description: 'Best deals',
    };
    const fragments = collectFragmentsFromRow('shopify_collections', row);
    assert.ok(fragments.some((f) => f.fieldPath === 'title'));
    assert.ok(fragments.some((f) => f.fieldPath === 'description'));
  });

  test('prod_master: extracts canonical_title and brand', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000004',
      canonical_title: 'Master Widget',
      brand: 'WidgetCo',
    };
    const fragments = collectFragmentsFromRow('prod_master', row);
    assert.ok(fragments.some((f) => f.fieldPath === 'canonical_title'));
    assert.ok(fragments.some((f) => f.fieldPath === 'brand'));
  });

  test('vendor/productType hints are passed through for products', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      title: 'Item',
      vendor: 'ACME',
      product_type: 'Hardware',
    };
    const fragments = collectFragmentsFromRow('shopify_products', row);
    const titleFrag = fragments.find((f) => f.fieldPath === 'title');
    assert.ok(titleFrag);
    assert.strictEqual(titleFrag.vendorHint, 'ACME');
    assert.strictEqual(titleFrag.productTypeHint, 'Hardware');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. PIPELINE-UTILS – shared pure helpers
 * ═══════════════════════════════════════════════════════════════════════ */

describe('pipeline-utils – sha256', () => {
  test('returns 64-char hex hash', () => {
    const hash = sha256('hello');
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]+$/);
  });

  test('deterministic', () => {
    assert.strictEqual(sha256('test'), sha256('test'));
  });

  test('different inputs produce different hashes', () => {
    assert.notStrictEqual(sha256('a'), sha256('b'));
  });
});

describe('pipeline-utils – sha256StableJson', () => {
  test('same object with different key order produces same hash', () => {
    const a = sha256StableJson({ b: 2, a: 1 });
    const b = sha256StableJson({ a: 1, b: 2 });
    assert.strictEqual(a, b);
  });

  test('different values produce different hashes', () => {
    assert.notStrictEqual(sha256StableJson({ x: 1 }), sha256StableJson({ x: 2 }));
  });
});

describe('pipeline-utils – normalizeWhitespace', () => {
  test('collapses multiple spaces', () => {
    assert.strictEqual(normalizeWhitespace('a   b'), 'a b');
  });

  test('trims leading/trailing', () => {
    assert.strictEqual(normalizeWhitespace('  hello  '), 'hello');
  });

  test('replaces tabs and newlines', () => {
    assert.strictEqual(normalizeWhitespace('a\tb\nc'), 'a b c');
  });
});

describe('pipeline-utils – normalizeLexeme', () => {
  test('lowercases', () => {
    assert.strictEqual(normalizeLexeme('Hello'), 'hello');
  });

  test('removes diacritics', () => {
    assert.strictEqual(normalizeLexeme('șurub'), 'surub');
  });

  test('removes punctuation', () => {
    assert.strictEqual(normalizeLexeme('hello!world'), 'hello world');
  });

  test('normalizes whitespace', () => {
    assert.strictEqual(normalizeLexeme('  a   b  '), 'a b');
  });

  test('preserves digits', () => {
    assert.strictEqual(normalizeLexeme('M12x1.5'), 'm12x1 5');
  });
});

describe('pipeline-utils – tokenizeLexText', () => {
  test('tokenizes simple text', () => {
    const tokens = tokenizeLexText('hello world');
    assert.strictEqual(tokens.length, 2);
    const [a, b] = tokens;
    assert.ok(a && b);
    assert.strictEqual(a.raw, 'hello');
    assert.strictEqual(b.raw, 'world');
  });

  test('tracks start/end positions', () => {
    const tokens = tokenizeLexText('ab cd');
    const [first, second] = tokens;
    assert.ok(first && second);
    assert.strictEqual(first.start, 0);
    assert.strictEqual(first.end, 2);
    assert.strictEqual(second.start, 3);
    assert.strictEqual(second.end, 5);
  });

  test('handles hyphenated tokens', () => {
    const tokens = tokenizeLexText('anti-corrosion');
    assert.strictEqual(tokens.length, 1);
    const [only] = tokens;
    assert.ok(only);
    assert.strictEqual(only.raw, 'anti-corrosion');
  });

  test('assigns sequential tokenIndex', () => {
    const tokens = tokenizeLexText('a b c');
    assert.deepStrictEqual(
      tokens.map((t) => t.tokenIndex),
      [0, 1, 2]
    );
  });

  test('empty text returns empty array', () => {
    assert.deepStrictEqual(tokenizeLexText(''), []);
  });

  test('normalized field is lowercased and diacritic-free', () => {
    const tokens = tokenizeLexText('Șurub');
    const [first] = tokens;
    assert.ok(first);
    assert.strictEqual(first.normalized, 'surub');
  });
});

describe('pipeline-utils – uniqueStrings', () => {
  test('deduplicates', () => {
    assert.deepStrictEqual(uniqueStrings(['a', 'b', 'a']), ['a', 'b']);
  });

  test('filters nulls and undefined', () => {
    assert.deepStrictEqual(uniqueStrings(['a', null, undefined, 'b']), ['a', 'b']);
  });

  test('trims values', () => {
    assert.deepStrictEqual(uniqueStrings([' a ', 'a']), ['a']);
  });

  test('skips empty strings', () => {
    assert.deepStrictEqual(uniqueStrings(['', '  ', 'a']), ['a']);
  });
});

describe('pipeline-utils – buildContextWindow', () => {
  test('extracts left/right context with default radius', () => {
    const tokens = tokenizeLexText('a b c d e f g');
    const ctx = buildContextWindow(tokens, 3, 3);
    assert.strictEqual(ctx.leftContext, 'a b c');
    assert.strictEqual(ctx.rightContext, 'e f g');
  });

  test('handles start of text (no left context)', () => {
    const tokens = tokenizeLexText('a b c');
    const ctx = buildContextWindow(tokens, 0, 0);
    assert.strictEqual(ctx.leftContext, '');
    assert.strictEqual(ctx.rightContext, 'b c');
  });

  test('handles end of text (no right context)', () => {
    const tokens = tokenizeLexText('a b c');
    const ctx = buildContextWindow(tokens, 2, 2);
    assert.strictEqual(ctx.rightContext, '');
  });

  test('custom radius', () => {
    const tokens = tokenizeLexText('a b c d e');
    const ctx = buildContextWindow(tokens, 2, 2, 1);
    assert.strictEqual(ctx.leftContext, 'b');
    assert.strictEqual(ctx.rightContext, 'd');
  });

  test('neighborTerms are unique normalized forms', () => {
    const tokens = tokenizeLexText('the bolt and the nut');
    const ctx = buildContextWindow(tokens, 2, 2);
    assert.ok(ctx.neighborTerms.includes('the'));
    assert.ok(ctx.neighborTerms.includes('bolt'));
    assert.ok(ctx.neighborTerms.includes('nut'));
  });
});

describe('pipeline-utils – parseShardSourceRecordIds', () => {
  test('extracts valid IDs', () => {
    const ids = parseShardSourceRecordIds({ sourceRecordIds: ['abc', 'def'] });
    assert.deepStrictEqual(ids, ['abc', 'def']);
  });

  test('filters empty strings', () => {
    const ids = parseShardSourceRecordIds({ sourceRecordIds: ['abc', '', '  '] });
    assert.deepStrictEqual(ids, ['abc']);
  });

  test('returns empty when key missing', () => {
    assert.deepStrictEqual(parseShardSourceRecordIds({}), []);
  });

  test('returns empty when not an array', () => {
    assert.deepStrictEqual(parseShardSourceRecordIds({ sourceRecordIds: 'not-array' }), []);
  });
});

describe('pipeline-utils – parseTouchedIds', () => {
  test('extracts by key', () => {
    assert.deepStrictEqual(parseTouchedIds({ termIdsTouched: ['x', 'y'] }, 'termIdsTouched'), [
      'x',
      'y',
    ]);
  });

  test('returns empty for missing key', () => {
    assert.deepStrictEqual(parseTouchedIds({}, 'termIdsTouched'), []);
  });
});

describe('pipeline-utils – toNumberOrZero', () => {
  test('passes through finite number', () => {
    assert.strictEqual(toNumberOrZero(42), 42);
  });

  test('parses numeric string', () => {
    assert.strictEqual(toNumberOrZero('3.14'), 3.14);
  });

  test('returns 0 for NaN', () => {
    assert.strictEqual(toNumberOrZero(Number.NaN), 0);
  });

  test('returns 0 for Infinity', () => {
    assert.strictEqual(toNumberOrZero(Infinity), 0);
  });

  test('returns 0 for null', () => {
    assert.strictEqual(toNumberOrZero(null), 0);
  });

  test('returns 0 for empty string', () => {
    assert.strictEqual(toNumberOrZero(''), 0);
  });

  test('returns 0 for non-numeric string', () => {
    assert.strictEqual(toNumberOrZero('abc'), 0);
  });
});

describe('pipeline-utils – decimalString', () => {
  test('formats with default 4 decimal places', () => {
    assert.strictEqual(decimalString(0.5), '0.5000');
  });

  test('custom scale', () => {
    assert.strictEqual(decimalString(1.23456, 2), '1.23');
  });

  test('handles NaN as 0', () => {
    assert.strictEqual(decimalString(Number.NaN), '0.0000');
  });

  test('handles Infinity as 0', () => {
    assert.strictEqual(decimalString(Infinity), '0.0000');
  });
});

describe('pipeline-utils – parseLexShopLangFromSettingsRow', () => {
  test('extracts source and target from row', () => {
    const pair = parseLexShopLangFromSettingsRow({
      sourceLang: 'fr',
      targetLangs: ['de', 'es'],
    });
    assert.strictEqual(pair.sourceLang, 'fr');
    assert.strictEqual(pair.targetLang, 'de');
  });

  test('defaults to ro/en when null', () => {
    const pair = parseLexShopLangFromSettingsRow(null);
    assert.strictEqual(pair.sourceLang, 'ro');
    assert.strictEqual(pair.targetLang, 'en');
  });

  test('defaults to ro/en when undefined', () => {
    const pair = parseLexShopLangFromSettingsRow(undefined);
    assert.strictEqual(pair.sourceLang, 'ro');
    assert.strictEqual(pair.targetLang, 'en');
  });

  test('falls back to defaults for empty strings', () => {
    const pair = parseLexShopLangFromSettingsRow({
      sourceLang: '  ',
      targetLangs: [''],
    });
    assert.strictEqual(pair.sourceLang, 'ro');
    assert.strictEqual(pair.targetLang, 'en');
  });
});

describe('pipeline-utils – tokenOverlapsProtectedSpan', () => {
  test('detects overlap', () => {
    assert.strictEqual(
      tokenOverlapsProtectedSpan({ start: 5, end: 10 }, [{ start: 8, end: 15 }]),
      true
    );
  });

  test('no overlap when exactly adjacent (before)', () => {
    assert.strictEqual(
      tokenOverlapsProtectedSpan({ start: 0, end: 5 }, [{ start: 5, end: 10 }]),
      false
    );
  });

  test('no overlap when exactly adjacent (after)', () => {
    assert.strictEqual(
      tokenOverlapsProtectedSpan({ start: 10, end: 15 }, [{ start: 0, end: 10 }]),
      false
    );
  });

  test('empty spans means no overlap', () => {
    assert.strictEqual(tokenOverlapsProtectedSpan({ start: 0, end: 10 }, []), false);
  });
});

describe('pipeline-utils – buildLocalizationContentHash', () => {
  test('returns 64-char hex hash', () => {
    const hash = buildLocalizationContentHash({
      entityType: 'product',
      entityId: 'id-1',
      targetLang: 'en',
      titleText: 'Title',
      descriptionText: null,
      descriptionShort: null,
      seoTitle: null,
      seoDescription: null,
      keywords: [],
    });
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  test('deterministic for same input', () => {
    const params = {
      entityType: 'product' as const,
      entityId: 'id-1',
      targetLang: 'en',
      titleText: 'Title',
      descriptionText: null,
      descriptionShort: null,
      seoTitle: null,
      seoDescription: null,
      keywords: ['kw'],
    };
    assert.strictEqual(buildLocalizationContentHash(params), buildLocalizationContentHash(params));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. AI-BATCHES – pure helpers
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ai-batches – estimateTokens', () => {
  test('approximates ~1 token per 4 chars', () => {
    assert.strictEqual(estimateTokens('12345678'), 2);
  });

  test('minimum is 1', () => {
    assert.strictEqual(estimateTokens('a'), 1);
  });

  test('empty string returns 1 (ceil(0/4) = 0 → max(1,0) = 1)', () => {
    assert.strictEqual(estimateTokens(''), 1);
  });

  test('longer text', () => {
    const text = 'x'.repeat(100);
    assert.strictEqual(estimateTokens(text), 25);
  });
});

describe('ai-batches – clampAiConfidence', () => {
  test('caps at provided cap', () => {
    assert.strictEqual(clampAiConfidence(0.99, 0.92), 0.92);
  });

  test('passes through values below cap', () => {
    assert.strictEqual(clampAiConfidence(0.5, 0.92), 0.5);
  });

  test('floors at 0', () => {
    assert.strictEqual(clampAiConfidence(-1, 0.92), 0);
  });

  test('NaN becomes 0', () => {
    assert.strictEqual(clampAiConfidence(Number.NaN, 0.92), 0);
  });

  test('Infinity becomes 0', () => {
    assert.strictEqual(clampAiConfidence(Infinity, 0.92), 0);
  });

  test('invalid cap defaults to 0.92', () => {
    assert.strictEqual(clampAiConfidence(0.95, Number.NaN), 0.92);
  });

  test('zero cap defaults to 0.92', () => {
    assert.strictEqual(clampAiConfidence(0.95, 0), 0.92);
  });
});

describe('ai-batches – isNoOpTranslation', () => {
  test('returns true for identical text', () => {
    assert.strictEqual(isNoOpTranslation('hello', 'hello'), true);
  });

  test('case insensitive', () => {
    assert.strictEqual(isNoOpTranslation('Hello', 'hello'), true);
  });

  test('trims whitespace', () => {
    assert.strictEqual(isNoOpTranslation('  hello  ', 'hello'), true);
  });

  test('returns false for different text', () => {
    assert.strictEqual(isNoOpTranslation('hello', 'world'), false);
  });

  test('returns false for partial overlap', () => {
    assert.strictEqual(isNoOpTranslation('hello world', 'hello'), false);
  });
});

describe('ai-batches – applyNoOpAndCap', () => {
  test('detects echo translation and forces confidence to 0.5', () => {
    const result = applyNoOpAndCap({
      canonicalText: 'racord',
      translation: 'racord',
      confidence: 0.95,
      confidenceCap: 0.92,
    });
    assert.strictEqual(result.echo, true);
    assert.strictEqual(result.confidence, 0.5);
  });

  test('caps confidence for non-echo', () => {
    const result = applyNoOpAndCap({
      canonicalText: 'racord',
      translation: 'connector',
      confidence: 0.99,
      confidenceCap: 0.92,
    });
    assert.strictEqual(result.echo, false);
    assert.strictEqual(result.confidence, 0.92);
  });

  test('passes through low confidence', () => {
    const result = applyNoOpAndCap({
      canonicalText: 'racord',
      translation: 'connector',
      confidence: 0.7,
      confidenceCap: 0.92,
    });
    assert.strictEqual(result.confidence, 0.7);
    assert.strictEqual(result.echo, false);
  });
});

describe('ai-batches – lexAiProducedConfidenceCap', () => {
  test('is threshold minus 0.01', () => {
    const cap = lexAiProducedConfidenceCap(0.93);
    assert.strictEqual(cap, 0.92);
  });

  test('clamps at 0.9999', () => {
    const cap = lexAiProducedConfidenceCap(1.5);
    assert.ok(cap <= 0.9999);
  });

  test('clamps at 0 for negative threshold', () => {
    const cap = lexAiProducedConfidenceCap(-0.5);
    assert.strictEqual(cap, 0);
  });

  test('very low threshold returns 0', () => {
    const cap = lexAiProducedConfidenceCap(0.005);
    assert.strictEqual(cap, 0);
  });
});

describe('ai-batches – shouldEscalateToConsensus', () => {
  test('consensus mode always escalates', () => {
    assert.strictEqual(
      shouldEscalateToConsensus({
        mode: 'consensus',
        llmConfidence: 0.99,
        threshold: 0.8,
        domainCode: 'hardware',
      }),
      true
    );
  });

  test('single mode never escalates', () => {
    assert.strictEqual(
      shouldEscalateToConsensus({
        mode: 'single',
        llmConfidence: 0.1,
        threshold: 0.8,
        domainCode: null,
      }),
      false
    );
  });

  test('auto mode escalates when no domain', () => {
    assert.strictEqual(
      shouldEscalateToConsensus({
        mode: 'auto',
        llmConfidence: 0.99,
        threshold: 0.8,
        domainCode: null,
      }),
      true
    );
  });

  test('auto mode escalates when confidence below threshold', () => {
    assert.strictEqual(
      shouldEscalateToConsensus({
        mode: 'auto',
        llmConfidence: 0.6,
        threshold: 0.8,
        domainCode: 'plumbing',
      }),
      true
    );
  });

  test('auto mode does NOT escalate when confidence above threshold with domain', () => {
    assert.strictEqual(
      shouldEscalateToConsensus({
        mode: 'auto',
        llmConfidence: 0.9,
        threshold: 0.8,
        domainCode: 'plumbing',
      }),
      false
    );
  });
});

describe('ai-batches – mapConsensusMethodToConfidence', () => {
  test('unanimous → 0.97 (within cap)', () => {
    const conf = mapConsensusMethodToConfidence('unanimous', 1, 0.99);
    assert.strictEqual(conf, 0.97);
  });

  test('majority → 0.85 + score * 0.1', () => {
    const conf = mapConsensusMethodToConfidence('majority', 0.5, 0.99);
    assert.ok(Math.abs(conf - 0.9) < 0.001);
  });

  test('arbitration uses score directly (clamped 0.5..0.95)', () => {
    const conf = mapConsensusMethodToConfidence('arbitration', 0.8, 0.99);
    assert.strictEqual(conf, 0.8);
  });

  test('single_fallback → 0.7', () => {
    const conf = mapConsensusMethodToConfidence('single_fallback', 0, 0.99);
    assert.strictEqual(conf, 0.7);
  });

  test('respects confidence cap', () => {
    const conf = mapConsensusMethodToConfidence('unanimous', 1, 0.92);
    assert.strictEqual(conf, 0.92);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. CLUSTER-SENSES – pure helpers
 * ═══════════════════════════════════════════════════════════════════════ */

describe('cluster-senses – buildGroupingKey', () => {
  test('joins domain, taxonomy, field', () => {
    const key = buildGroupingKey({
      id: 'ctx-1',
      termId: 't-1',
      representativeText: 'text',
      fieldKind: 'title',
      domainCode: 'hardware',
      taxonomyId: 'tax-1',
      occurrencesCount: '5',
    });
    assert.strictEqual(key, 'hardware|tax-1|title');
  });

  test('uses "none" placeholders for nulls', () => {
    const key = buildGroupingKey({
      id: 'ctx-1',
      termId: 't-1',
      representativeText: 'text',
      fieldKind: null,
      domainCode: null,
      taxonomyId: null,
      occurrencesCount: '1',
    });
    assert.strictEqual(key, 'domain:none|taxonomy:none|field:none');
  });

  test('partial nulls use selective placeholders', () => {
    const key = buildGroupingKey({
      id: 'ctx-1',
      termId: 't-1',
      representativeText: 'text',
      fieldKind: 'vendor',
      domainCode: null,
      taxonomyId: 'tax-2',
      occurrencesCount: '3',
    });
    assert.strictEqual(key, 'domain:none|tax-2|vendor');
  });
});

describe('cluster-senses – clusterCompositeKey', () => {
  test('joins with unit separator', () => {
    const key = clusterCompositeKey('term-1', 'auto:abc');
    assert.ok(key.includes('term-1'));
    assert.ok(key.includes('auto:abc'));
    assert.ok(key.includes('\x1f'));
  });

  test('different inputs produce different keys', () => {
    assert.notStrictEqual(clusterCompositeKey('a', 'b'), clusterCompositeKey('b', 'a'));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. TRANSLATE-CANDIDATES – pure helpers
 * ═══════════════════════════════════════════════════════════════════════ */

describe('compose-localizations – containsComposeDisallowedControlChars', () => {
  test('allows TAB, LF, CR', () => {
    assert.strictEqual(containsComposeDisallowedControlChars('a\tb'), false);
    assert.strictEqual(containsComposeDisallowedControlChars('a\nb'), false);
    assert.strictEqual(containsComposeDisallowedControlChars('a\rb'), false);
  });

  test('detects NUL, VT, FF, DEL and C0 excluding TAB/LF/CR', () => {
    assert.strictEqual(containsComposeDisallowedControlChars('\x00'), true);
    assert.strictEqual(containsComposeDisallowedControlChars('\x08'), true);
    assert.strictEqual(containsComposeDisallowedControlChars('\x0b'), true);
    assert.strictEqual(containsComposeDisallowedControlChars('\x0c'), true);
    assert.strictEqual(containsComposeDisallowedControlChars('\x1f'), true);
    assert.strictEqual(containsComposeDisallowedControlChars('\x7f'), true);
  });

  test('plain text is safe', () => {
    assert.strictEqual(containsComposeDisallowedControlChars('Hello 世界'), false);
  });
});

describe('compose-localizations – extractHtmlTagNamesFromMarkup', () => {
  test('collects tag names from open and close tags', () => {
    const tags = extractHtmlTagNamesFromMarkup('<div><p>x</p></div>');
    assert.deepStrictEqual(tags, ['div', 'p', 'p', 'div']);
  });

  test('empty string yields empty array', () => {
    assert.deepStrictEqual(extractHtmlTagNamesFromMarkup(''), []);
  });
});

describe('compose-localizations – buildLexReplacementRulesFromTranslationRows', () => {
  test('builds one rule per non-empty source variant', () => {
    const rules = buildLexReplacementRulesFromTranslationRows([
      {
        translationText: 'bar',
        qualityScore: '0.9',
        sourceTexts: ['foo', '  ', 'baz'],
      },
    ]);
    assert.strictEqual(rules.length, 2);
    assert.ok(rules.some((r) => r.sourceText === 'foo' && r.targetText === 'bar'));
    assert.ok(rules.some((r) => r.sourceText === 'baz' && r.qualityScore === 0.9));
  });

  test('empty sourceTexts yields no rules', () => {
    assert.deepStrictEqual(
      buildLexReplacementRulesFromTranslationRows([
        { translationText: 'x', qualityScore: null, sourceTexts: [] },
      ]),
      []
    );
  });
});

describe('translate-candidates – summarizeConfidenceDistribution', () => {
  test('computes min/max/avg/median for odd count', () => {
    const result = summarizeConfidenceDistribution([0.5, 0.7, 0.9]);
    assert.strictEqual(result.count, 3);
    assert.strictEqual(result.min, 0.5);
    assert.strictEqual(result.max, 0.9);
    assert.strictEqual(result.median, 0.7);
    assert.ok(result.avg !== null && Math.abs(result.avg - 0.7) < 0.001);
  });

  test('computes median for even count', () => {
    const result = summarizeConfidenceDistribution([0.4, 0.6, 0.8, 1]);
    assert.strictEqual(result.count, 4);
    assert.strictEqual(result.median, 0.7);
  });

  test('empty array returns nulls', () => {
    const result = summarizeConfidenceDistribution([]);
    assert.strictEqual(result.count, 0);
    assert.strictEqual(result.min, null);
    assert.strictEqual(result.max, null);
    assert.strictEqual(result.avg, null);
    assert.strictEqual(result.median, null);
  });

  test('filters out non-finite values', () => {
    const result = summarizeConfidenceDistribution([Number.NaN, 0.5, Infinity, 0.9]);
    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.min, 0.5);
    assert.strictEqual(result.max, 0.9);
  });

  test('single value', () => {
    const result = summarizeConfidenceDistribution([0.85]);
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.min, 0.85);
    assert.strictEqual(result.max, 0.85);
    assert.strictEqual(result.median, 0.85);
    assert.strictEqual(result.avg, 0.85);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. COMPOSE-LOCALIZATIONS – pure helpers
 * ═══════════════════════════════════════════════════════════════════════ */

describe('compose-localizations – maybeAppend', () => {
  test('null base returns next value', () => {
    assert.strictEqual(maybeAppend(null, 'hello'), 'hello');
  });

  test('null next returns base', () => {
    assert.strictEqual(maybeAppend('base', null), 'base');
  });

  test('appends with double newline', () => {
    assert.strictEqual(maybeAppend('first', 'second'), 'first\n\nsecond');
  });

  test('skips duplicate content', () => {
    assert.strictEqual(maybeAppend('hello world', 'hello'), 'hello world');
  });

  test('both null returns null', () => {
    assert.strictEqual(maybeAppend(null, null), null);
  });
});

describe('compose-localizations – averageQuality computation', () => {
  test('average quality = qualityAccumulator / qualityMatchCount', () => {
    const qualityAccumulator = 0.9 + 0.8 + 0.7;
    const qualityMatchCount = 3;
    const avg = qualityMatchCount > 0 ? qualityAccumulator / qualityMatchCount : 0;
    assert.ok(Math.abs(avg - 0.8) < 0.001);
  });

  test('zero match count gives 0', () => {
    const qualityAccumulator = 1;
    const qualityMatchCount = 0;
    const avg = qualityMatchCount > 0 ? qualityAccumulator / qualityMatchCount : 0;
    assert.strictEqual(avg, 0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. COMPOSE-APPLY-TRANSLATIONS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('compose-apply-translations – applyTranslations', () => {
  test('replaces matching terms', () => {
    const { text, matchCount } = applyTranslations('racord din alama', [
      { sourceText: 'racord', targetText: 'connector', qualityScore: 0.9 },
      { sourceText: 'alama', targetText: 'brass', qualityScore: 0.85 },
    ]);
    assert.strictEqual(text, 'connector din brass');
    assert.strictEqual(matchCount, 2);
  });

  test('no rules returns original', () => {
    const { text, matchCount } = applyTranslations('hello', []);
    assert.strictEqual(text, 'hello');
    assert.strictEqual(matchCount, 0);
  });

  test('longest match wins', () => {
    const { text } = applyTranslations('robinet de bucătărie', [
      { sourceText: 'robinet', targetText: 'faucet', qualityScore: 0.9 },
      { sourceText: 'robinet de bucătărie', targetText: 'kitchen faucet', qualityScore: 0.95 },
    ]);
    assert.strictEqual(text, 'kitchen faucet');
  });

  test('accumulates quality', () => {
    const { qualityTotal, matchCount } = applyTranslations('a b', [
      { sourceText: 'a', targetText: 'x', qualityScore: 0.8 },
      { sourceText: 'b', targetText: 'y', qualityScore: 0.9 },
    ]);
    assert.strictEqual(matchCount, 2);
    assert.ok(Math.abs(qualityTotal - 1.7) < 0.001);
  });

  test('returns matched keywords', () => {
    const { matchedKeywords } = applyTranslations('racord', [
      { sourceText: 'racord', targetText: 'connector', qualityScore: 0.9 },
    ]);
    assert.deepStrictEqual(matchedKeywords, ['connector']);
  });

  test('single pass: no cascade', () => {
    const { text } = applyTranslations('racord', [
      { sourceText: 'racord', targetText: 'connector', qualityScore: 0.9 },
      { sourceText: 'connector', targetText: 'fitting', qualityScore: 0.9 },
    ]);
    assert.strictEqual(text, 'connector');
  });

  test('case-insensitive matching', () => {
    const { text, matchCount } = applyTranslations('Racord', [
      { sourceText: 'racord', targetText: 'connector', qualityScore: 0.9 },
    ]);
    assert.strictEqual(text, 'connector');
    assert.strictEqual(matchCount, 1);
  });
});
