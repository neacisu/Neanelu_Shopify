import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import * as readline from 'node:readline';

export type JsonlChunk = Readonly<{
  index: number;
  filePath: string;
  bytes: number;
  rows: number;
  sha256: string;
}>;

export type ChunkJsonlFileResult = Readonly<{
  chunks: readonly JsonlChunk[];
  totalRows: number;
}>;

export async function chunkJsonlFile(params: {
  inputPath: string;
  outputDir: string;
  targetBytes: number;
  filePrefix: string;
}): Promise<ChunkJsonlFileResult> {
  const targetBytes = Math.max(1, Math.floor(params.targetBytes));
  await mkdir(params.outputDir, { recursive: true });

  const chunks: JsonlChunk[] = [];

  let chunkIndex = 0;
  let totalRows = 0;

  let currentStream: NodeJS.WritableStream | null = null;
  let currentPath: string | null = null;
  let currentBytes = 0;
  let currentRows = 0;
  let currentHash = createHash('sha256');

  const finalizeChunk = async (): Promise<void> => {
    const stream = currentStream;
    const filePath = currentPath;
    if (!stream || !filePath) return;

    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });

    // Do not emit empty chunks.
    if (currentRows > 0) {
      chunks.push({
        index: chunkIndex,
        filePath,
        bytes: currentBytes,
        rows: currentRows,
        sha256: currentHash.digest('hex'),
      });
    }

    currentStream = null;
    currentPath = null;
    currentBytes = 0;
    currentRows = 0;
    currentHash = createHash('sha256');
  };

  const startChunk = (): void => {
    const name = `${params.filePrefix}.chunk-${String(chunkIndex).padStart(4, '0')}.jsonl`;
    currentPath = path.join(params.outputDir, name);
    currentStream = createWriteStream(currentPath, { encoding: 'utf8' });
  };

  startChunk();

  const rl = readline.createInterface({
    input: createReadStream(params.inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of rl) {
    // Preserve lines as-is; readline strips the newline. We always add a single '\n'.
    const line = rawLine;
    const out = `${line}\n`;
    const lineBytes = Buffer.byteLength(out, 'utf8');

    // If a single line exceeds the target, still write it (Shopify may reject, but
    // splitting a JSONL line is not possible without altering semantics).
    if (currentRows > 0 && currentBytes + lineBytes > targetBytes) {
      await finalizeChunk();
      chunkIndex += 1;
      startChunk();
    }

    if (!currentStream) {
      // Should not happen, but keeps strict-null checking happy.
      startChunk();
    }

    if (!currentStream) {
      throw new Error('chunkJsonlFile_invariant_no_write_stream');
    }

    (currentStream as unknown as { write: (chunk: string) => void }).write(out);
    currentBytes += lineBytes;
    currentRows += 1;
    totalRows += 1;
    currentHash.update(out, 'utf8');
  }

  await finalizeChunk();

  return { chunks, totalRows };
}
