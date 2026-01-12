import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { filterJsonlByLineNumbers } from './filter-jsonl-by-line-numbers.js';

void describe('filterJsonlByLineNumbers', () => {
  void it('writes only selected 1-based line numbers and computes sha256', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'neanelu-filter-jsonl-'));
    const inputPath = path.join(tmp, 'input.jsonl');

    const lines = ['{"n":1}', '{"n":2}', '{"n":3}', '{"n":4}'];
    await writeFile(inputPath, `${lines.join('\n')}\n`, 'utf8');

    const include = new Set<number>([2, 4]);
    const out = await filterJsonlByLineNumbers({
      inputPath,
      outputDir: tmp,
      outputName: 'filtered.jsonl',
      includeLines: include,
    });

    assert.equal(out.rows, 2);
    assert.ok(out.bytes > 0);
    assert.equal(out.sha256.length, 64);

    const content = await readFile(out.filePath, 'utf8');
    const expected = `${lines[1]}\n${lines[3]}\n`;
    assert.equal(content, expected);

    const h = createHash('sha256').update(expected, 'utf8').digest('hex');
    assert.equal(out.sha256, h);
  });
});
