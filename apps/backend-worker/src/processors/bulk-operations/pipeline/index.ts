/**
 * Bulk Operations Streaming Pipeline (PR-040 / F5.2.1-F5.2.3)
 *
 * Scope in this PR:
 * - Robust HTTP download stream (retry/backoff, timeouts, best-effort Range resume, compression)
 * - Tolerant JSONL parsing with counters and minimal schema validation
 *
 * NOTE: Transform/COPY stages are implemented in later PRs (PR-041+).
 */

import { pipeline } from 'node:stream/promises';
import { Writable, Transform } from 'node:stream';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';

import { createDownloadStream } from './stages/download.js';
import { createJsonlParseStream } from './stages/parse.js';
import type { MinimalBulkJsonlObject, PipelineCounters, ParseIssue } from './types.js';
import {
  ParentChildRemapper,
  type StitchingCounters,
  type StitchedRecord,
} from './stages/transformation/stitching/parent-child-remapper.js';
import type { Logger } from '@app/logger';
import { trace } from '@opentelemetry/api';
import { buildBulkSpanAttributes } from '../otel/spans.js';

export type RunBulkStreamingPipelineParams = Readonly<{
  url: string;
  /** Best-effort resume offset (bytes). Used as Range start for identity streams. */
  resumeFromBytes?: number;
  /** Optional download stream buffer sizing. */
  downloadHighWaterMarkBytes?: number;
  /**
   * When true, emits parse issues (invalid lines) via callback instead of throwing.
   * Defaults to true (tolerant mode).
   */
  tolerateInvalidLines?: boolean;
  /** Called for every valid JSON object. Must be fast; use backpressure if doing I/O. */
  onItem: (obj: MinimalBulkJsonlObject) => Promise<void> | void;
  /** Optional callback for invalid line diagnostics (no payload). */
  onParseIssue?: (issue: ParseIssue) => void;
  /** Parser engine. Default is 'stream-json' to match PR-040 requirements. */
  parseEngine?: 'stream-json' | 'json-parse';
}>;

export type RunBulkStreamingPipelineResult = Readonly<{
  counters: PipelineCounters;
}>;

export type RunBulkStreamingPipelineWithStitchingParams = Readonly<{
  shopId: string;
  bulkRunId?: string | null;
  operationType?: string | null;
  artifactsDir: string;
  logger: Logger;
  url: string;
  /** Optional JSONL file persistence path. If set, the raw stream is saved to disk. */
  persistJsonlPath?: string | null;
  /** Append to the JSONL file (used when resuming). */
  persistJsonlAppend?: boolean;
  /** Best-effort resume offset (bytes). Used as Range start for identity streams. */
  resumeFromBytes?: number;
  /** Optional counters object to be mutated by the parse stage (useful for progress/checkpointing). */
  counters?: PipelineCounters;
  /** Optional download stream buffer sizing. */
  downloadHighWaterMarkBytes?: number;
  tolerateInvalidLines?: boolean;
  parseEngine?: 'stream-json' | 'json-parse';
  onRecord: (record: StitchedRecord) => Promise<void> | void;
  onParseIssue?: (issue: ParseIssue) => void;
  onDownloadRetry?: (params: { attempt: number; reason: string; delayMs: number }) => void;
  onDownloadChunk?: (params: { bytes: number; chunkIndex: number }) => void;
  bucketCount?: number;
  maxInMemoryParents?: number;
  maxInMemoryOrphans?: number;
}>;

export type RunBulkStreamingPipelineWithStitchingResult = Readonly<{
  counters: PipelineCounters;
  stitching: StitchingCounters;
}>;

export type RunBulkStreamingPipelineWithStitchingFromFileParams = Readonly<{
  shopId: string;
  bulkRunId?: string | null;
  operationType?: string | null;
  artifactsDir: string;
  logger: Logger;
  filePath: string;
  /** Optional read offset (bytes) for resume. */
  startOffsetBytes?: number;
  /** Optional counters object to be mutated by the parse stage (useful for progress/checkpointing). */
  counters?: PipelineCounters;
  /** Optional read stream buffer sizing. */
  readHighWaterMarkBytes?: number;
  tolerateInvalidLines?: boolean;
  parseEngine?: 'stream-json' | 'json-parse';
  onRecord: (record: StitchedRecord) => Promise<void> | void;
  onParseIssue?: (issue: ParseIssue) => void;
  bucketCount?: number;
  maxInMemoryParents?: number;
  maxInMemoryOrphans?: number;
}>;

/**
 * Minimal end-to-end pipeline (download → parse → consumer).
 *
 * This is intentionally DB-agnostic; workers can wire it into bulk_steps/bulk_runs.
 */
export async function runBulkStreamingPipeline(
  params: RunBulkStreamingPipelineParams
): Promise<RunBulkStreamingPipelineResult> {
  const counters: PipelineCounters = {
    bytesProcessed: 0,
    totalLines: 0,
    validLines: 0,
    invalidLines: 0,
  };

  const download = await createDownloadStream({
    url: params.url,
    ...(params.resumeFromBytes !== undefined ? { resumeFromBytes: params.resumeFromBytes } : {}),
    ...(params.downloadHighWaterMarkBytes !== undefined
      ? { highWaterMarkBytes: params.downloadHighWaterMarkBytes }
      : {}),
  });

  const parseParams: Parameters<typeof createJsonlParseStream>[0] = {
    counters,
    tolerateInvalidLines: params.tolerateInvalidLines ?? true,
    engine: params.parseEngine ?? 'stream-json',
  };
  if (params.onParseIssue) {
    parseParams.onParseIssue = params.onParseIssue;
  }
  const parse = createJsonlParseStream(parseParams);

  const sink = new Writable({
    objectMode: true,
    write: (obj: unknown, _enc, cb) => {
      Promise.resolve(params.onItem(obj as MinimalBulkJsonlObject))
        .then(() => cb())
        .catch((err) => cb(err instanceof Error ? err : new Error('onItem_failed')));
    },
  });

  await pipeline(download.stream, parse, sink);
  return { counters };
}

/**
 * Pipeline with stitching transform (PR-041 / F5.2.4 + F5.2.11).
 *
 * download → parse → remap (__parentId) → emit records
 */
export async function runBulkStreamingPipelineWithStitching(
  params: RunBulkStreamingPipelineWithStitchingParams
): Promise<RunBulkStreamingPipelineWithStitchingResult> {
  const counters: PipelineCounters = params.counters ?? {
    bytesProcessed: 0,
    totalLines: 0,
    validLines: 0,
    invalidLines: 0,
  };

  const remapper = new ParentChildRemapper({
    shopId: params.shopId,
    artifactsDir: params.artifactsDir,
    logger: params.logger,
    onRecord: params.onRecord,
    ...(params.bucketCount !== undefined ? { bucketCount: params.bucketCount } : {}),
    ...(params.maxInMemoryParents !== undefined
      ? { maxInMemoryParents: params.maxInMemoryParents }
      : {}),
    ...(params.maxInMemoryOrphans !== undefined
      ? { maxInMemoryOrphans: params.maxInMemoryOrphans }
      : {}),
  });
  await remapper.init();

  const tracer = trace.getTracer('neanelu-shopify');
  const baseAttrs = {
    shopId: params.shopId,
    bulkRunId: params.bulkRunId ?? null,
    operationType: params.operationType ?? null,
  } as const;
  const downloadAttrs = buildBulkSpanAttributes({ ...baseAttrs, step: 'download' });
  const parseAttrs = buildBulkSpanAttributes({ ...baseAttrs, step: 'parse' });
  const transformAttrs = buildBulkSpanAttributes({ ...baseAttrs, step: 'transform' });

  const transformSpan = tracer.startSpan('bulk.transform', { attributes: transformAttrs });

  let chunkIndex = 0;
  let chunkBytesSinceLastSpan = 0;
  const DOWNLOAD_CHUNK_SPAN_BYTES = 25 * 1024 * 1024;

  const download = await createDownloadStream({
    url: params.url,
    ...(params.downloadHighWaterMarkBytes !== undefined
      ? { highWaterMarkBytes: params.downloadHighWaterMarkBytes }
      : {}),
    ...(params.onDownloadRetry ? { onRetry: params.onDownloadRetry } : {}),
    onChunk: ({ bytes }) => {
      if (bytes <= 0) return;
      const prev = chunkBytesSinceLastSpan;
      const next = prev + bytes;
      chunkBytesSinceLastSpan = next;
      if (next < DOWNLOAD_CHUNK_SPAN_BYTES) return;
      chunkBytesSinceLastSpan = 0;
      chunkIndex += 1;
      params.onDownloadChunk?.({ bytes: next, chunkIndex });
      const span = tracer.startSpan('bulk.download.chunk', {
        attributes: {
          ...downloadAttrs,
          'bulk.chunk_index': chunkIndex,
          'bulk.chunk_bytes': next,
        },
      });
      span.end();
    },
  });
  const downloadSpan = tracer.startSpan('bulk.download', { attributes: downloadAttrs });
  download.stream.once('end', () => downloadSpan.end());
  download.stream.once('error', (err) => {
    if (err instanceof Error) downloadSpan.recordException(err);
    downloadSpan.end();
  });

  const parse = createJsonlParseStream({
    counters,
    tolerateInvalidLines: params.tolerateInvalidLines ?? true,
    engine: params.parseEngine ?? 'stream-json',
    ...(params.onParseIssue ? { onParseIssue: params.onParseIssue } : {}),
  });
  const parseSpan = tracer.startSpan('bulk.parse', { attributes: parseAttrs });
  parse.once('end', () => parseSpan.end());
  parse.once('error', (err) => {
    if (err instanceof Error) parseSpan.recordException(err);
    parseSpan.end();
  });

  const sink = new Writable({
    objectMode: true,
    write: (obj: unknown, _enc, cb) => {
      Promise.resolve(remapper.processLine(obj as MinimalBulkJsonlObject))
        .then(() => cb())
        .catch((err) => cb(err instanceof Error ? err : new Error('stitch_process_failed')));
    },
  });

  let persistStream: ReturnType<typeof createWriteStream> | null = null;
  let persistTransform: Transform | null = null;
  if (params.persistJsonlPath) {
    await mkdir(path.dirname(params.persistJsonlPath), { recursive: true });
    persistStream = createWriteStream(params.persistJsonlPath, {
      flags: params.persistJsonlAppend ? 'a' : 'w',
    });
    persistTransform = new Transform({
      transform: (chunk: Buffer | string, _enc, cb) => {
        if (!persistStream) {
          cb(new Error('persist_stream_missing'));
          return;
        }
        const onError = (err: Error): void => {
          persistStream?.removeListener('error', onError);
          cb(err);
        };
        persistStream.once('error', onError);
        persistStream.write(chunk, (err) => {
          persistStream?.removeListener('error', onError);
          if (err) {
            cb(err);
            return;
          }
          cb(null, chunk);
        });
      },
    });
  }

  try {
    if (persistTransform) {
      await pipeline(download.stream, persistTransform, parse, sink);
    } else {
      await pipeline(download.stream, parse, sink);
    }
    await remapper.finalize();
  } finally {
    if (persistStream) {
      await new Promise<void>((resolve, reject) => {
        persistStream.once('error', reject);
        persistStream.end(() => resolve());
      }).catch(() => undefined);
    }
    transformSpan.end();
  }

  return { counters, stitching: remapper.getCounters() };
}

/**
 * Pipeline with stitching transform sourced from a local JSONL file.
 * Used as a fallback if the remote stream is interrupted.
 */
export async function runBulkStreamingPipelineWithStitchingFromFile(
  params: RunBulkStreamingPipelineWithStitchingFromFileParams
): Promise<RunBulkStreamingPipelineWithStitchingResult> {
  const counters: PipelineCounters = params.counters ?? {
    bytesProcessed: 0,
    totalLines: 0,
    validLines: 0,
    invalidLines: 0,
  };

  const remapper = new ParentChildRemapper({
    shopId: params.shopId,
    artifactsDir: params.artifactsDir,
    logger: params.logger,
    onRecord: params.onRecord,
    ...(params.bucketCount !== undefined ? { bucketCount: params.bucketCount } : {}),
    ...(params.maxInMemoryParents !== undefined
      ? { maxInMemoryParents: params.maxInMemoryParents }
      : {}),
    ...(params.maxInMemoryOrphans !== undefined
      ? { maxInMemoryOrphans: params.maxInMemoryOrphans }
      : {}),
  });
  await remapper.init();

  const tracer = trace.getTracer('neanelu-shopify');
  const baseAttrs = {
    shopId: params.shopId,
    bulkRunId: params.bulkRunId ?? null,
    operationType: params.operationType ?? null,
  } as const;
  const parseAttrs = buildBulkSpanAttributes({ ...baseAttrs, step: 'parse' });
  const transformAttrs = buildBulkSpanAttributes({ ...baseAttrs, step: 'transform' });
  const transformSpan = tracer.startSpan('bulk.transform', { attributes: transformAttrs });

  const readStream = createReadStream(params.filePath, {
    ...(params.readHighWaterMarkBytes ? { highWaterMark: params.readHighWaterMarkBytes } : {}),
    ...(params.startOffsetBytes && params.startOffsetBytes > 0
      ? { start: Math.max(0, Math.trunc(params.startOffsetBytes)) }
      : {}),
  });

  const parse = createJsonlParseStream({
    counters,
    tolerateInvalidLines: params.tolerateInvalidLines ?? true,
    engine: params.parseEngine ?? 'stream-json',
    ...(params.onParseIssue ? { onParseIssue: params.onParseIssue } : {}),
  });
  const parseSpan = tracer.startSpan('bulk.parse', { attributes: parseAttrs });
  parse.once('end', () => parseSpan.end());
  parse.once('error', (err) => {
    if (err instanceof Error) parseSpan.recordException(err);
    parseSpan.end();
  });

  const sink = new Writable({
    objectMode: true,
    write: (obj: unknown, _enc, cb) => {
      Promise.resolve(remapper.processLine(obj as MinimalBulkJsonlObject))
        .then(() => cb())
        .catch((err) => cb(err instanceof Error ? err : new Error('stitch_process_failed')));
    },
  });

  try {
    await pipeline(readStream, parse, sink);
    await remapper.finalize();
  } finally {
    transformSpan.end();
  }

  return { counters, stitching: remapper.getCounters() };
}
