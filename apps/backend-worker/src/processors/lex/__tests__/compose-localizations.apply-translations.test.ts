/* node:test — describe/test returnează promisiuni planificate de runner; nu se await-uiesc la înregistrare. */
/* eslint-disable @typescript-eslint/no-floating-promises */

import assert from 'node:assert';
import { describe, test } from 'node:test';

import { applyTranslations } from '../compose-apply-translations.js';

describe('applyTranslations (single-pass)', () => {
  test('nu aplica a doua regulă pe text generat de prima (fără cascadă)', () => {
    const rules = [
      { sourceText: 'racord', targetText: 'connector', qualityScore: 0.9 },
      { sourceText: 'connector', targetText: 'fitting', qualityScore: 0.9 },
    ];
    const { text } = applyTranslations('racord', rules);
    assert.strictEqual(text, 'connector');
  });

  test('prioritizează sursa mai lungă: „A B” înainte de „A”', () => {
    const rules = [
      { sourceText: 'A', targetText: 'X', qualityScore: 0.9 },
      { sourceText: 'A B', targetText: 'Y', qualityScore: 0.9 },
    ];
    const { text, matchCount } = applyTranslations('prefix A B suffix', rules);
    assert.strictEqual(text, 'prefix Y suffix');
    assert.strictEqual(matchCount, 1);
  });

  test('înlocuiește ambele apariții din textul original când sunt independente', () => {
    const rules = [
      { sourceText: 'racord', targetText: 'connector', qualityScore: 0.8 },
      { sourceText: 'connector', targetText: 'fitting', qualityScore: 0.8 },
    ];
    const { text } = applyTranslations('racord și connector', rules);
    assert.strictEqual(text, 'connector și fitting');
  });
});
