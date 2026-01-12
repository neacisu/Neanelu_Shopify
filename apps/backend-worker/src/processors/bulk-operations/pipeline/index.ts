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
import { Writable } from 'node:stream';

import { createDownloadStream } from './stages/download.js';
import { createJsonlParseStream } from './stages/parse.js';
import type { MinimalBulkJsonlObject, PipelineCounters, ParseIssue } from './types.js';

export type RunBulkStreamingPipelineParams = Readonly<{
  url: string;
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
