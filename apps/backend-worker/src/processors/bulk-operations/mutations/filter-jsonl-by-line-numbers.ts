import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';

export type FilterJsonlResult = Readonly<{
  filePath: string;
  rows: number;
  bytes: number;
  sha256: string;
}>;

export async function filterJsonlByLineNumbers(params: {
  inputPath: string;
  outputDir: string;
  outputName: string;
  includeLines: ReadonlySet<number>; // 1-based
}): Promise<FilterJsonlResult> {
  await mkdir(params.outputDir, { recursive: true });
  const outputPath = path.join(params.outputDir, params.outputName);

  const outStream = createWriteStream(outputPath, { encoding: 'utf8' });
  const hash = createHash('sha256');

  let bytes = 0;
  let rows = 0;
  let lineNo = 0;

  try {
    const rl = readline.createInterface({
      input: createReadStream(params.inputPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const rawLine of rl) {
      lineNo += 1;
      if (!params.includeLines.has(lineNo)) continue;

      const out = `${rawLine}\n`;
      (outStream as unknown as { write: (chunk: string) => void }).write(out);
      rows += 1;
      bytes += Buffer.byteLength(out, 'utf8');
      hash.update(out, 'utf8');
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      outStream.end(() => resolve());
      outStream.on('error', reject);
    });
  }

  return { filePath: outputPath, rows, bytes, sha256: hash.digest('hex') };
}
