export interface PipelineCounters {
  /** Total raw bytes observed from the HTTP response body (after decompression, if applied). */
  bytesProcessed: number;
  /** Total newline-delimited lines observed. */
  totalLines: number;
  /** Lines that parsed as JSON objects and passed minimal validation. */
  validLines: number;
  /** Lines that were empty, invalid JSON, or failed minimal validation. */
  invalidLines: number;
}

export type MinimalBulkJsonlObject = Readonly<Record<string, unknown>>;

export type ParseIssue = Readonly<{
  lineNumber: number;
  kind: 'empty_line' | 'invalid_json' | 'invalid_shape';
  message: string;
}>;
