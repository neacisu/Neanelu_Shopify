import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  buildClusterSenseGroupingKey,
  buildPreparedClusterSenseGroups,
  type LexClusterSenseContextRow,
  type LexClusterSenseTermLabelRow,
} from '../cluster-senses-pure.js';

function ctx(
  overrides: Partial<LexClusterSenseContextRow> & Pick<LexClusterSenseContextRow, 'id' | 'termId'>
): LexClusterSenseContextRow {
  return {
    representativeText: 't',
    fieldKind: 'title',
    domainCode: 'd1',
    taxonomyId: 'tax1',
    occurrencesCount: '1',
    ...overrides,
  };
}

function term(
  overrides: Partial<LexClusterSenseTermLabelRow> & Pick<LexClusterSenseTermLabelRow, 'id'>
): LexClusterSenseTermLabelRow {
  return {
    displayTextRo: null,
    canonicalText: 'Canon',
    ...overrides,
  };
}

void describe('buildClusterSenseGroupingKey', () => {
  void test('joins domain, taxonomy, field with fallbacks', () => {
    assert.strictEqual(
      buildClusterSenseGroupingKey(
        ctx({ id: 'c1', termId: 't1', domainCode: null, taxonomyId: null, fieldKind: null })
      ),
      'domain:none|taxonomy:none|field:none'
    );
    assert.strictEqual(
      buildClusterSenseGroupingKey(
        ctx({ id: 'c1', termId: 't1', domainCode: 'x', taxonomyId: 'y', fieldKind: 'z' })
      ),
      'x|y|z'
    );
  });
});

void describe('buildPreparedClusterSenseGroups', () => {
  void test('returns empty when no contexts for terms', () => {
    const termMap = new Map<string, LexClusterSenseTermLabelRow>([['t1', term({ id: 't1' })]]);
    const byTerm = new Map<string, LexClusterSenseContextRow[]>([['t1', []]]);
    assert.deepStrictEqual(buildPreparedClusterSenseGroups(['t1'], byTerm, termMap), []);
  });

  void test('single bucket: approved, high confidence, label from displayTextRo', () => {
    const termMap = new Map<string, LexClusterSenseTermLabelRow>([
      ['t1', term({ id: 't1', displayTextRo: 'RO Label', canonicalText: 'Canon' })],
    ]);
    const c1 = ctx({ id: 'c1', termId: 't1', occurrencesCount: '5' });
    const byTerm = new Map<string, LexClusterSenseContextRow[]>([['t1', [c1]]]);
    const out = buildPreparedClusterSenseGroups(['t1'], byTerm, termMap);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0]!.labelRo, 'RO Label');
    assert.strictEqual(out[0]!.isApproved, true);
    assert.strictEqual(out[0]!.needsReview, false);
    assert.strictEqual(out[0]!.confidence, 0.96);
    assert.strictEqual(out[0]!.representative.id, 'c1');
    assert.ok(out[0]!.clusterKey.startsWith('auto:'));
  });

  void test('two contexts same grouping key: one cluster, still single-bucket semantics', () => {
    const termMap = new Map<string, LexClusterSenseTermLabelRow>([['t1', term({ id: 't1' })]]);
    const cLow = ctx({
      id: 'c-low',
      termId: 't1',
      domainCode: 'd',
      taxonomyId: 'tax',
      fieldKind: 'f',
      occurrencesCount: '1',
    });
    const cHigh = ctx({
      id: 'c-high',
      termId: 't1',
      domainCode: 'd',
      taxonomyId: 'tax',
      fieldKind: 'f',
      occurrencesCount: '99',
    });
    const byTerm = new Map<string, LexClusterSenseContextRow[]>([['t1', [cLow, cHigh]]]);
    const out = buildPreparedClusterSenseGroups(['t1'], byTerm, termMap);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0]!.members.length, 2);
    assert.strictEqual(out[0]!.representative.id, 'c-high');
    assert.strictEqual(out[0]!.needsReview, false);
  });

  void test('two distinct grouping keys: needs review, lower confidence on both', () => {
    const termMap = new Map<string, LexClusterSenseTermLabelRow>([['t1', term({ id: 't1' })]]);
    const c1 = ctx({ id: 'a', termId: 't1', domainCode: 'd1', occurrencesCount: '1' });
    const c2 = ctx({ id: 'b', termId: 't1', domainCode: 'd2', occurrencesCount: '1' });
    const byTerm = new Map<string, LexClusterSenseContextRow[]>([['t1', [c1, c2]]]);
    const out = buildPreparedClusterSenseGroups(['t1'], byTerm, termMap);
    assert.strictEqual(out.length, 2);
    for (const g of out) {
      assert.strictEqual(g.needsReview, true);
      assert.strictEqual(g.isApproved, false);
      assert.strictEqual(g.confidence, 0.72);
    }
  });

  void test('falls back to canonicalText when displayTextRo is null', () => {
    const termMap = new Map<string, LexClusterSenseTermLabelRow>([
      ['t1', term({ id: 't1', displayTextRo: null, canonicalText: 'Fallback' })],
    ]);
    const c1 = ctx({ id: 'c1', termId: 't1', occurrencesCount: '1' });
    const byTerm = new Map<string, LexClusterSenseContextRow[]>([['t1', [c1]]]);
    const out = buildPreparedClusterSenseGroups(['t1'], byTerm, termMap);
    assert.strictEqual(out[0]!.labelRo, 'Fallback');
  });
});
