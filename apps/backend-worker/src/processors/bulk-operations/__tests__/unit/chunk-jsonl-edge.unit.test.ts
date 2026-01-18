import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { chunkJsonlFile } from '../../mutations/chunk-jsonl-file.js';

void describe('chunkJsonlFile edge cases', () => {
  void it('returns no chunks for an empty file', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'neanelu-chunk-empty-'));
    const inputPath = path.join(tmp, 'empty.jsonl');
    await writeFile(inputPath, '', 'utf8');

    const outDir = path.join(tmp, 'out');
    const res = await chunkJsonlFile({
      inputPath,
      outputDir: outDir,
      targetBytes: 128,
      filePrefix: 'empty',
    });

    assert.equal(res.totalRows, 0);
    assert.equal(res.chunks.length, 0);
  });

  void it('keeps a single chunk when lines fit exactly in targetBytes', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'neanelu-chunk-exact-'));
    const inputPath = path.join(tmp, 'exact.jsonl');
    const line = JSON.stringify({ id: 1 });
    const content = `${line}\n${line}\n`;
    await writeFile(inputPath, content, 'utf8');

    const targetBytes = Buffer.byteLength(content, 'utf8');
    const outDir = path.join(tmp, 'out');
    const res = await chunkJsonlFile({
      inputPath,
      outputDir: outDir,
      targetBytes,
      filePrefix: 'exact',
    });

    assert.equal(res.totalRows, 2);
    assert.equal(res.chunks.length, 1);

    const chunk = res.chunks[0];
    assert.ok(chunk);
    const read = await readFile(chunk.filePath, 'utf8');
    assert.equal(read, content);
  });
});
