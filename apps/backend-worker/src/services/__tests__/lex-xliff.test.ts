import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseXliffUnits } from '../lex-xliff.js';

void describe('lex-xliff (isolated)', () => {
  void test('parseXliffUnits skips unit when inner capture is missing', () => {
    const xml = `<?xml version="1.0"?><xliff><file><unit id="u1"></unit></file></xliff>`;
    assert.deepStrictEqual(parseXliffUnits(xml), []);
  });

  void test('parseXliffUnits parses source and target when present', () => {
    const xml = `<?xml version="1.0"?>
<xliff><file><unit id="term-1">
<segment><source>Hello</source><target>Bună</target></segment>
</unit></file></xliff>`;
    const units = parseXliffUnits(xml);
    assert.strictEqual(units.length, 1);
    assert.strictEqual(units[0]?.id, 'term-1');
    assert.strictEqual(units[0]?.source, 'Hello');
    assert.strictEqual(units[0]?.target, 'Bună');
  });
});
