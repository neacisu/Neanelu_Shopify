import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  buildPreparedLexAttributeResolutionRow,
  type LexAttributeResolutionInputRow,
} from '../resolve-attribute-resolution-prepared.js';

type InputRow = LexAttributeResolutionInputRow;

function inputRow(overrides?: Partial<InputRow>): InputRow {
  return {
    termId: '11111111-1111-1111-1111-111111111111',
    clusterId: null,
    canonicalText: 'Mărime',
    normalizedKey: 'marime',
    ...overrides,
  };
}

void describe('buildPreparedLexAttributeResolutionRow', () => {
  void test('without definition: pending, review_required, no publication', () => {
    const defLookup = new Map<string, string>();
    const synLookup = new Map<string, string>();
    const out = buildPreparedLexAttributeResolutionRow(inputRow(), 'en', defLookup, synLookup);
    assert.strictEqual(out.definitionId, null);
    assert.strictEqual(out.confidence, 0.41);
    assert.strictEqual(out.status, 'pending');
    assert.strictEqual(out.publication, null);
    const ev = JSON.parse(out.evidenceJson) as { strategy: string };
    assert.strictEqual(ev.strategy, 'review_required');
  });

  void test('definition from prod_attr_definitions map: approved, publication payload', () => {
    const defId = '22222222-2222-2222-2222-222222222222';
    const defLookup = new Map([['mărime', defId]]);
    const synLookup = new Map<string, string>();
    const row = inputRow({ canonicalText: 'Mărime' });
    const out = buildPreparedLexAttributeResolutionRow(row, 'de', defLookup, synLookup);
    assert.strictEqual(out.definitionId, defId);
    assert.strictEqual(out.confidence, 0.98);
    assert.strictEqual(out.status, 'approved');
    assert.ok(out.publication);
    assert.strictEqual(out.publication.targetPath, 'locale:de');
    assert.ok(out.publication.idempotencyKey.includes(defId));
    assert.ok(out.publication.idempotencyKey.startsWith('lex-target:prod_attr_synonyms:'));
    const payload = JSON.parse(out.publication.payloadJson) as {
      definitionId: string;
      synonymText: string;
      locale: string;
      source: string;
      confidenceScore: number;
    };
    assert.strictEqual(payload.definitionId, defId);
    assert.strictEqual(payload.synonymText, 'Mărime');
    assert.strictEqual(payload.locale, 'de');
    assert.strictEqual(payload.source, 'lex_module');
    assert.strictEqual(payload.confidenceScore, 0.98);
  });

  void test('falls back to synonym map when label not in definitions', () => {
    const defId = '33333333-3333-3333-3333-333333333333';
    const defLookup = new Map<string, string>();
    const synLookup = new Map([['mărime', defId]]);
    const out = buildPreparedLexAttributeResolutionRow(inputRow(), 'en', defLookup, synLookup);
    assert.strictEqual(out.definitionId, defId);
    assert.strictEqual(out.status, 'approved');
    assert.ok(out.publication);
  });

  void test('definition map wins over synonym map for same key', () => {
    const fromDef = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const fromSyn = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const defLookup = new Map([['mărime', fromDef]]);
    const synLookup = new Map([['mărime', fromSyn]]);
    const out = buildPreparedLexAttributeResolutionRow(inputRow(), 'en', defLookup, synLookup);
    assert.strictEqual(out.definitionId, fromDef);
  });
});
