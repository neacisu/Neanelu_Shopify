import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../../queue/lex-queues.js', () => ({
  enqueueLexPublishJob: vi.fn().mockResolvedValue('mock-job-id'),
}));

vi.mock('@app/database', () => ({
  withTenantContext: vi.fn(),
}));

import {
  scanLexTranslationPair,
  validateLexOutputSchemaRaw,
  validateLexOutputSchema,
  validateTermContent,
  validateCompositionIntegrity,
  finalPublishSafetyCheck,
} from '../lex-guardrails.js';

import { finalLexReviewItemStatus } from '../lex-review-actions.js';

import { escapeXml, unescapeXml, parseXliffUnits } from '../lex-xliff.js';

import { mapLexFieldToShopifyKey } from '../lex-shopify-sync.js';

// ─────────────────────────────────────────────────────────────────────────────
// lex-guardrails.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('scanLexTranslationPair', () => {
  it('detects no-op translation (case-insensitive)', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello World',
      targetText: 'hello world',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.type === 'noop_translation')).toBe(true);
  });

  it('passes when source and target differ', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello',
      targetText: 'Salut',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('detects information added (target >3× source length)', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hi',
      targetText:
        'A very long translation that is way more than three times the source text length',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.issues.some((i) => i.type === 'information_added')).toBe(true);
  });

  it('detects information lost (target <20% of source length)', () => {
    const result = scanLexTranslationPair({
      sourceText:
        'This is a rather long sentence that needs a proper translation to be done correctly',
      targetText: 'X',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.issues.some((i) => i.type === 'information_lost')).toBe(true);
  });

  it('detects HTML injection — script tag', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello',
      targetText: '<script>alert(1)</script>Salut',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.issues.some((i) => i.type === 'html_injection')).toBe(true);
  });

  it('detects HTML injection — iframe tag', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello',
      targetText: '<iframe src="evil.com"></iframe>',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.issues.some((i) => i.type === 'html_injection')).toBe(true);
  });

  it('detects HTML injection — event handler', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello',
      targetText: '<div onload=alert(1)>Salut</div>',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.issues.some((i) => i.type === 'html_injection')).toBe(true);
  });

  it('detects HTML injection — javascript URI', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello',
      targetText: '<a href="javascript:alert(1)">Click</a>',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.issues.some((i) => i.type === 'html_injection')).toBe(true);
  });

  it('detects HTML injection — data:text/html URI', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello',
      targetText: '<a href="data:text/html,<h1>bad</h1>">link</a>',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.issues.some((i) => i.type === 'html_injection')).toBe(true);
  });

  it('detects placeholder leak ([REDACTED_*])', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello',
      targetText: 'Salut [REDACTED_NAME]',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.issues.some((i) => i.type === 'placeholder_leak')).toBe(true);
  });

  it('detects wrong language — Romanian diacritics in English target', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Salut',
      targetText: 'Grădină frumoasă',
      sourceLang: 'ro',
      targetLang: 'en',
    });
    expect(result.issues.some((i) => i.type === 'wrong_language')).toBe(true);
  });

  it('does not flag Romanian diacritics when target is Romanian', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Garden',
      targetText: 'Grădină frumoasă',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.issues.some((i) => i.type === 'wrong_language')).toBe(false);
  });

  it('detects placeholder missing in target', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello {{name}}, welcome!',
      targetText: 'Salut, bun venit!',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.issues.some((i) => i.type === 'placeholder_missing_in_target')).toBe(true);
  });

  it('detects placeholder added in target', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello!',
      targetText: 'Salut {{name}}!',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.issues.some((i) => i.type === 'placeholder_added_in_target')).toBe(true);
  });

  it('passes when placeholders match', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello {{name}}, you have %count% items',
      targetText: 'Salut {{name}}, ai %count% obiecte',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.issues.filter((i) => i.type.startsWith('placeholder_'))).toHaveLength(0);
  });

  it('rejects both empty strings', () => {
    const result = scanLexTranslationPair({
      sourceText: '',
      targetText: '',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.type === 'both_empty')).toBe(true);
  });

  it('rejects whitespace-only strings (both empty after trim)', () => {
    const result = scanLexTranslationPair({
      sourceText: '   ',
      targetText: '   ',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.type === 'both_empty')).toBe(true);
  });

  it('flags target empty while source has content', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello',
      targetText: '',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.type === 'target_empty')).toBe(true);
  });

  it('flags source empty while target has content', () => {
    const result = scanLexTranslationPair({
      sourceText: '',
      targetText: 'Salut',
      sourceLang: 'en',
      targetLang: 'ro',
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.type === 'source_empty')).toBe(true);
  });

  it('flags invalid (empty) language codes', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello',
      targetText: 'Salut',
      sourceLang: '',
      targetLang: 'ro',
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.type === 'invalid_language_code')).toBe(true);
  });

  it('flags same language pair', () => {
    const result = scanLexTranslationPair({
      sourceText: 'Hello',
      targetText: 'World',
      sourceLang: 'en',
      targetLang: 'en',
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.type === 'same_language_pair')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('validateLexOutputSchemaRaw', () => {
  it('returns valid for well-formed JSON matching schema', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = validateLexOutputSchemaRaw({
      rawOutput: '{"name":"Alice","age":30}',
      schema,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.parsed).toEqual({ name: 'Alice', age: 30 });
    }
  });

  it('returns invalid_json for malformed JSON', () => {
    const schema = z.object({ name: z.string() });
    const result = validateLexOutputSchemaRaw({
      rawOutput: '{not valid json',
      schema,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('invalid_json');
    }
  });

  it('returns schema_mismatch when JSON does not match schema', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = validateLexOutputSchemaRaw({
      rawOutput: '{"name":"Alice","age":"not_a_number"}',
      schema,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('schema_mismatch');
      expect(result.details).toBeDefined();
    }
  });

  it('returns valid for empty object matching permissive schema', () => {
    const schema = z.record(z.string(), z.unknown());
    const result = validateLexOutputSchemaRaw({ rawOutput: '{}', schema });
    expect(result.valid).toBe(true);
  });

  it('returns invalid_json for empty string', () => {
    const schema = z.object({});
    const result = validateLexOutputSchemaRaw({ rawOutput: '', schema });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('invalid_json');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('validateLexOutputSchema', () => {
  it('returns valid for correct structured output', () => {
    const result = validateLexOutputSchema({
      translation: 'Salut',
      confidence: 0.95,
      alternatives: ['Bună'],
      reasoning: 'common greeting',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('rejects missing required fields', () => {
    const result = validateLexOutputSchema({ translation: 'Salut' });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('rejects confidence out of range', () => {
    const result = validateLexOutputSchema({
      translation: 'Salut',
      confidence: 5,
    });
    expect(result.valid).toBe(false);
  });

  it('accepts output without optional fields', () => {
    const result = validateLexOutputSchema({
      translation: 'Salut',
      confidence: 0.8,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects empty translation string', () => {
    const result = validateLexOutputSchema({
      translation: '',
      confidence: 0.8,
    });
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('validateTermContent', () => {
  it('returns valid for normal text', () => {
    const result = validateTermContent('normal text');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('rejects text exceeding 200 characters', () => {
    const longText = 'a'.repeat(201);
    const result = validateTermContent(longText);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('term_text_exceeds_200_chars');
  });

  it('accepts text with exactly 200 characters', () => {
    const text = 'a'.repeat(200);
    const result = validateTermContent(text);
    expect(result.valid).toBe(true);
  });

  it('rejects text with control characters', () => {
    const result = validateTermContent('hello\x01world');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('term_text_contains_control_characters');
  });

  it('allows tab, newline, carriage return', () => {
    const result = validateTermContent('hello\tworld\nfoo\rbar');
    expect(result.valid).toBe(true);
  });

  it('accepts supplementary-plane characters (emoji) without false control positives', () => {
    const result = validateTermContent('Emoji 😀 term');
    expect(result.valid).toBe(true);
  });

  it('rejects text with URL', () => {
    const result = validateTermContent('visit https://example.com now');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('term_text_contains_url');
  });

  it('rejects text with www URL', () => {
    const result = validateTermContent('check www.example.com');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('term_text_contains_url');
  });

  it('rejects text with email address', () => {
    const result = validateTermContent('contact user@example.com');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('term_text_contains_email');
  });

  it('accepts text with @ sign that is not an email', () => {
    const result = validateTermContent('@mention');
    expect(result.valid).toBe(true);
  });

  it('returns valid for empty string', () => {
    const result = validateTermContent('');
    expect(result.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('validateCompositionIntegrity', () => {
  it('passes for balanced HTML', () => {
    const result = validateCompositionIntegrity('<p>Hello World</p>', '<p>Salut Lume</p>');
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('detects unclosed HTML tags', () => {
    const result = validateCompositionIntegrity('<p>Hello</p>', '<p>Salut');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.startsWith('unclosed_html_tags'))).toBe(true);
  });

  it('detects mismatched closing tag', () => {
    const result = validateCompositionIntegrity('<p>Hello</p>', '<p>Salut</div>');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('unbalanced_or_mismatched_closing_tag'))).toBe(
      true
    );
  });

  it('allows void/self-closing HTML tags', () => {
    const result = validateCompositionIntegrity(
      'Hello<br>World<img src="x"/>',
      'Salut<br>Lume<img src="y"/>'
    );
    expect(result.valid).toBe(true);
  });

  it('strips multiple nested tags consistently for structure checks', () => {
    const result = validateCompositionIntegrity('<b><i>A</i></b>', '<b><i>Z</i></b>');
    expect(result.valid).toBe(true);
  });

  it('detects output length ratio outside 0.3x–3x', () => {
    const result = validateCompositionIntegrity(
      'This is a normal-length sentence for testing ratio detection logic.',
      'X'
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('output_length_ratio'))).toBe(true);
  });

  it('detects non-printable characters in output', () => {
    const result = validateCompositionIntegrity('Hello', 'Salut\x01Lume');
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('output_contains_non_printable_characters');
  });

  it('passes for plain text without HTML', () => {
    const result = validateCompositionIntegrity('Hello World', 'Salut Lume');
    expect(result.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('finalPublishSafetyCheck', () => {
  it('passes for valid translation pair', () => {
    const result = finalPublishSafetyCheck('Hello World', 'Salut Lume');
    expect(result.safe).toBe(true);
  });

  it('rejects empty original', () => {
    const result = finalPublishSafetyCheck('', 'Salut');
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('original_empty');
  });

  it('rejects empty translated', () => {
    const result = finalPublishSafetyCheck('Hello', '');
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('translated_empty');
  });

  it('rejects whitespace-only original', () => {
    const result = finalPublishSafetyCheck('   ', 'Salut');
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('original_empty');
  });

  it('rejects [REDACTED_*] placeholder in translated text', () => {
    const result = finalPublishSafetyCheck('Hello', 'Salut [REDACTED_NAME]');
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('translated_contains_redacted_placeholder');
  });

  it('rejects translation with >80% length diff for text ≥10 chars', () => {
    const result = finalPublishSafetyCheck(
      'This is a somewhat long original text for testing',
      'AB'
    );
    expect(result.safe).toBe(false);
    expect(result.reason).toBe('translation_length_diff_exceeds_80_percent_suspect');
  });

  it('rejects translation too similar to source (Dice similarity >0.92)', () => {
    const original = 'Automation testing framework';
    const result = finalPublishSafetyCheck(original, original);
    expect(result.safe).toBe(false);
  });

  it('allows short texts even if lengths differ a lot', () => {
    const result = finalPublishSafetyCheck('Hi', 'Salutare');
    expect(result.safe).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lex-review-actions.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('finalLexReviewItemStatus', () => {
  it('returns rejected for "reject"', () => {
    expect(finalLexReviewItemStatus('reject')).toBe('rejected');
  });

  it('returns approved for "approve"', () => {
    expect(finalLexReviewItemStatus('approve')).toBe('approved');
  });

  it('returns approved for "merge_terms"', () => {
    expect(finalLexReviewItemStatus('merge_terms')).toBe('approved');
  });

  it('returns approved for "split_cluster"', () => {
    expect(finalLexReviewItemStatus('split_cluster')).toBe('approved');
  });

  it('returns approved for "lock_translation"', () => {
    expect(finalLexReviewItemStatus('lock_translation')).toBe('approved');
  });

  it('returns approved for "publish"', () => {
    expect(finalLexReviewItemStatus('publish')).toBe('approved');
  });

  it('throws for "assign"', () => {
    expect(() => finalLexReviewItemStatus('assign')).toThrow('assign_requires_assign_endpoint');
  });

  it('throws for unknown decision type', () => {
    expect(() => finalLexReviewItemStatus('bogus' as never)).toThrow('unknown_decision_type');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lex-xliff.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('escapeXml', () => {
  it('escapes ampersand', () => {
    expect(escapeXml('A & B')).toBe('A &amp; B');
  });

  it('escapes less-than', () => {
    expect(escapeXml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater-than', () => {
    expect(escapeXml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quote', () => {
    expect(escapeXml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('escapes single quote (apostrophe)', () => {
    expect(escapeXml("it's")).toBe('it&apos;s');
  });

  it('escapes all special chars together', () => {
    expect(escapeXml('<a href="x">&\'test\'')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&apos;test&apos;'
    );
  });

  it('returns empty string unchanged', () => {
    expect(escapeXml('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(escapeXml('Hello World')).toBe('Hello World');
  });
});

describe('unescapeXml', () => {
  it('unescapes &amp;', () => {
    expect(unescapeXml('A &amp; B')).toBe('A & B');
  });

  it('unescapes &lt;', () => {
    expect(unescapeXml('a &lt; b')).toBe('a < b');
  });

  it('unescapes &gt;', () => {
    expect(unescapeXml('a &gt; b')).toBe('a > b');
  });

  it('unescapes &quot;', () => {
    expect(unescapeXml('say &quot;hello&quot;')).toBe('say "hello"');
  });

  it('unescapes &apos;', () => {
    expect(unescapeXml('it&apos;s')).toBe("it's");
  });

  it('is inverse of escapeXml', () => {
    const original = '<div class="test">&\'hello\'</div>';
    expect(unescapeXml(escapeXml(original))).toBe(original);
  });

  it('handles empty string', () => {
    expect(unescapeXml('')).toBe('');
  });
});

describe('parseXliffUnits', () => {
  it('parses valid XLIFF with multiple units', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en" trgLang="ro">
<file id="lex-translations">
  <unit id="term-1">
    <segment>
      <source>Hello</source>
      <target>Salut</target>
    </segment>
  </unit>
  <unit id="term-2">
    <segment>
      <source>World</source>
      <target>Lume</target>
    </segment>
  </unit>
</file>
</xliff>`;

    const units = parseXliffUnits(xml);
    expect(units).toHaveLength(2);
    expect(units[0]).toEqual({ id: 'term-1', source: 'Hello', target: 'Salut' });
    expect(units[1]).toEqual({ id: 'term-2', source: 'World', target: 'Lume' });
  });

  it('unescapes XML entities in source and target', () => {
    const xml = `<xliff version="2.0">
<file id="test">
  <unit id="u1">
    <segment>
      <source>A &amp; B &lt;C&gt;</source>
      <target>X &amp; Y &lt;Z&gt;</target>
    </segment>
  </unit>
</file>
</xliff>`;

    const units = parseXliffUnits(xml);
    expect(units).toHaveLength(1);
    expect(units[0]?.source).toBe('A & B <C>');
    expect(units[0]?.target).toBe('X & Y <Z>');
  });

  it('returns empty array for empty XLIFF', () => {
    const xml = `<?xml version="1.0"?><xliff version="2.0"><file id="f"></file></xliff>`;
    expect(parseXliffUnits(xml)).toHaveLength(0);
  });

  it('skips units without source or target', () => {
    const xml = `<xliff version="2.0"><file id="f">
  <unit id="u1">
    <segment><source>Hello</source></segment>
  </unit>
  <unit id="u2">
    <segment><target>Salut</target></segment>
  </unit>
</file></xliff>`;

    expect(parseXliffUnits(xml)).toHaveLength(0);
  });

  it('handles multiline source and target content', () => {
    const xml = `<xliff version="2.0"><file id="f">
  <unit id="u1">
    <segment>
      <source>Line 1
Line 2</source>
      <target>Linia 1
Linia 2</target>
    </segment>
  </unit>
</file></xliff>`;

    const units = parseXliffUnits(xml);
    expect(units).toHaveLength(1);
    expect(units[0]?.source).toContain('Line 1');
    expect(units[0]?.source).toContain('Line 2');
  });

  it('returns empty array for non-XML string', () => {
    expect(parseXliffUnits('not xml at all')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// lex-shopify-sync.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('mapLexFieldToShopifyKey', () => {
  it('maps "title" to "title"', () => {
    expect(mapLexFieldToShopifyKey('title')).toBe('title');
  });

  it('maps "description" to "body_html"', () => {
    expect(mapLexFieldToShopifyKey('description')).toBe('body_html');
  });

  it('maps "description_html" to "body_html"', () => {
    expect(mapLexFieldToShopifyKey('description_html')).toBe('body_html');
  });

  it('maps "body_html" to "body_html"', () => {
    expect(mapLexFieldToShopifyKey('body_html')).toBe('body_html');
  });

  it('maps "seo_title" to "meta_title"', () => {
    expect(mapLexFieldToShopifyKey('seo_title')).toBe('meta_title');
  });

  it('maps "meta_title" to "meta_title"', () => {
    expect(mapLexFieldToShopifyKey('meta_title')).toBe('meta_title');
  });

  it('maps "seo_description" to "meta_description"', () => {
    expect(mapLexFieldToShopifyKey('seo_description')).toBe('meta_description');
  });

  it('maps "meta_description" to "meta_description"', () => {
    expect(mapLexFieldToShopifyKey('meta_description')).toBe('meta_description');
  });

  it('maps "handle" to "handle"', () => {
    expect(mapLexFieldToShopifyKey('handle')).toBe('handle');
  });

  it('returns null for unknown field', () => {
    expect(mapLexFieldToShopifyKey('unknown_field')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(mapLexFieldToShopifyKey('')).toBeNull();
  });
});
