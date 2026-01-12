import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { chunkJsonlFile } from './chunk-jsonl-file.js';

void describe('chunkJsonlFile', () => {
  void it('splits JSONL into multiple chunks by targetBytes', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'neanelu-chunk-jsonl-'));
    const inputPath = path.join(tmp, 'input.jsonl');

    // 6 short lines; with a tiny targetBytes this should create multiple chunks.
    const lines = Array.from({ length: 6 }, (_, i) => JSON.stringify({ i: i + 1 })).join('\n');
    await writeFile(inputPath, `${lines}\n`, 'utf8');

    const outDir = path.join(tmp, 'out');
    const res = await chunkJsonlFile({
      inputPath,
      outputDir: outDir,
      targetBytes: 20,
      filePrefix: 'test',
    });

    assert.equal(res.totalRows, 6);
    assert.ok(res.chunks.length >= 2);

    const chunkRows = res.chunks.reduce((sum, c) => sum + c.rows, 0);
    assert.equal(chunkRows, 6);

    for (const chunk of res.chunks) {
      assert.ok(chunk.filePath.includes(outDir));
      assert.ok(chunk.bytes > 0);
      assert.ok(chunk.rows > 0);
      assert.equal(chunk.sha256.length, 64);

      const content = await readFile(chunk.filePath, 'utf8');
      assert.ok(content.endsWith('\n'));
    }
  });
});
