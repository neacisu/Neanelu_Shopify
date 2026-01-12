import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createJsonlParseStream } from './parse.js';

void describe('pipeline: parse stage', () => {
  void it('parses valid lines and continues on invalid lines in tolerant mode', async () => {
    const counters = {
      bytesProcessed: 0,
      totalLines: 0,
      validLines: 0,
      invalidLines: 0,
    };

    const issues: { lineNumber: number; kind: string }[] = [];
    const parse = createJsonlParseStream({
      counters,
      tolerateInvalidLines: true,
      engine: 'stream-json',
      onParseIssue: (i) => issues.push({ lineNumber: i.lineNumber, kind: i.kind }),
    });

    const out: unknown[] = [];
    parse.on('data', (obj) => out.push(obj));

    parse.write('{"id":"gid://shopify/Product/1"}\n');
    parse.write('not-json\n');
    parse.write('{"__typename":"Product"}\n');
    parse.write('{"foo":1}\n');
    parse.end('\n');

    await new Promise<void>((resolve, reject) => {
      parse.on('end', () => resolve());
      parse.on('error', reject);
    });

    assert.equal(out.length, 2);
    assert.equal(counters.totalLines, 5);
    assert.equal(counters.validLines, 2);
    assert.equal(counters.invalidLines, 3);
    assert.ok(counters.bytesProcessed > 0);
    assert.deepEqual(
      issues.map((i) => i.kind),
      ['invalid_json', 'invalid_shape', 'empty_line']
    );
  });
});
