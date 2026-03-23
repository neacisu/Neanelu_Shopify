import assert from 'node:assert';
import { describe, test } from 'node:test';

import { detectTechnicalEntities, type TechnicalMatch } from '../extract-entities-pure.js';

function firstHitOfType(hits: readonly TechnicalMatch[], entityType: string): TechnicalMatch {
  const h = hits.find((x) => x.entityType === entityType);
  if (h === undefined) {
    assert.fail(`expected entityType ${entityType}`);
  }
  return h;
}

void describe('detectTechnicalEntities', () => {
  void test('voltage: strips internal whitespace and uppercases', () => {
    const hits = detectTechnicalEntities('Alimentare 230 V nominal');
    const v = firstHitOfType(hits, 'voltage');
    assert.strictEqual(v.text, '230 V');
    assert.strictEqual(v.normalizedValue, '230V');
    assert.strictEqual(v.unit, 'V');
  });

  void test('frequency: strips whitespace like voltage', () => {
    const hits = detectTechnicalEntities('50 Hz AC');
    const f = firstHitOfType(hits, 'frequency');
    assert.strictEqual(f.normalizedValue, '50HZ');
    assert.strictEqual(f.unit, 'Hz');
  });

  void test('fraction: inch mark before word char is captured; typographic quote normalizes to ASCII', () => {
    const curly = '\u201d'; // ”
    // Trailing `\b` after optional quote requires a word char after the quote (space breaks the match).
    const hits = detectTechnicalEntities(`Drill bit 3/8${curly}shaft pilot`);
    const fr = firstHitOfType(hits, 'fraction');
    assert.strictEqual(fr.text, `3/8${curly}`);
    assert.strictEqual(fr.normalizedValue, '3/8"');
    assert.strictEqual(fr.unit, '"');
  });

  void test('fraction without trailing quote still matches', () => {
    const hits = detectTechnicalEntities('ratio 5/8 end');
    const fr = firstHitOfType(hits, 'fraction');
    assert.strictEqual(fr.text, '5/8');
    assert.strictEqual(fr.normalizedValue, '5/8');
  });

  void test('technical_code uppercases', () => {
    const hits = detectTechnicalEntities('Valve DN25 flange');
    const t = firstHitOfType(hits, 'technical_code');
    assert.strictEqual(t.normalizedValue, 'DN25');
  });
});
