import { StringDecoder } from 'node:string_decoder';
import { Transform } from 'node:stream';

import JsonlParser from 'stream-json/jsonl/Parser.js';

import type { MinimalBulkJsonlObject, ParseIssue, PipelineCounters } from '../types.js';

interface JsonlParserLike {
  on(event: 'data', listener: (evt: unknown) => void): unknown;
  on(event: 'error', listener: (err: unknown) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  end(chunk: string, encoding: BufferEncoding): void;
}

type JsonlParserConstructor = new () => JsonlParserLike;

export function createJsonlParseStream(params: {
  counters: PipelineCounters;
  tolerateInvalidLines: boolean;
  /** Parser engine. Default is 'stream-json' to align with PR-040 plan. */
  engine?: 'stream-json' | 'json-parse';
  onParseIssue?: (issue: ParseIssue) => void;
}): Transform {
  const decoder = new StringDecoder('utf8');
  let buffered = '';
  let lineNumber = 0;

  const report = (issue: ParseIssue): void => {
    params.onParseIssue?.(issue);
  };

  const engine = params.engine ?? 'stream-json';

  const processLine = async (
    rawLine: string,
    push: (obj: MinimalBulkJsonlObject) => void
  ): Promise<void> => {
    lineNumber += 1;
    params.counters.totalLines += 1;

    const line = rawLine.replace(/\r$/, '').trim();
    if (!line) {
      params.counters.invalidLines += 1;
      report({ lineNumber, kind: 'empty_line', message: 'Empty line' });
      if (!params.tolerateInvalidLines) {
        throw new Error('bulk_parse_empty_line');
      }
      return;
    }

    let obj: unknown;
    try {
      if (engine === 'json-parse') {
        obj = JSON.parse(line);
      } else {
        obj = await parseJsonlLineWithStreamJson(line);
      }
    } catch (err) {
      params.counters.invalidLines += 1;
      report({
        lineNumber,
        kind: 'invalid_json',
        message: err instanceof Error ? err.message : 'Invalid JSON',
      });
      if (!params.tolerateInvalidLines) {
        throw new Error('bulk_parse_invalid_json', { cause: err });
      }
      return;
    }

    if (!isMinimallyValidBulkObject(obj)) {
      params.counters.invalidLines += 1;
      report({ lineNumber, kind: 'invalid_shape', message: 'Missing id/__typename' });
      if (!params.tolerateInvalidLines) {
        throw new Error('bulk_parse_invalid_shape');
      }
      return;
    }

    params.counters.validLines += 1;
    push(obj);
  };

  return new Transform({
    readableObjectMode: true,
    writableObjectMode: false,
    transform(chunk: Buffer | string, _enc, callback) {
      (async () => {
        const str = typeof chunk === 'string' ? chunk : decoder.write(chunk);
        params.counters.bytesProcessed += Buffer.byteLength(str, 'utf8');

        buffered += str;
        let idx = buffered.indexOf('\n');
        while (idx !== -1) {
          const line = buffered.slice(0, idx);
          buffered = buffered.slice(idx + 1);
          await processLine(line, (obj) => this.push(obj));
          idx = buffered.indexOf('\n');
        }

        callback();
      })().catch((err) => {
        callback(err instanceof Error ? err : new Error('bulk_parse_failed'));
      });
    },
    flush(callback) {
      (async () => {
        const rest = decoder.end();
        if (rest) {
          params.counters.bytesProcessed += Buffer.byteLength(rest, 'utf8');
          buffered += rest;
        }
        if (buffered.length > 0) {
          await processLine(buffered, (obj) => this.push(obj));
          buffered = '';
        }
        callback();
      })().catch((err) => {
        callback(err instanceof Error ? err : new Error('bulk_parse_flush_failed'));
      });
    },
  });
}

function isMinimallyValidBulkObject(value: unknown): value is MinimalBulkJsonlObject {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  const id = obj['id'];
  const typename = obj['__typename'];
  return (
    (typeof id === 'string' && id.length > 0) ||
    (typeof typename === 'string' && typename.length > 0)
  );
}

async function parseJsonlLineWithStreamJson(line: string): Promise<unknown> {
  // Parse a single JSON value using stream-json's JSONL parser.
  // Using a per-line parser keeps PR-040's tolerance requirement: invalid lines won't poison the whole stream.
  const JsonlParserCtor = JsonlParser as unknown as JsonlParserConstructor;
  const parser = new JsonlParserCtor();

  return await new Promise<unknown>((resolve, reject) => {
    let gotValue = false;

    parser.on('data', (evt: unknown) => {
      // stream-json/jsonl/Parser emits { key: number, value: any }
      const e = evt as { value?: unknown };
      if (!gotValue) {
        gotValue = true;
        resolve(e.value);
      }
    });

    parser.on('error', (e: unknown) => {
      reject(e instanceof Error ? e : new Error('stream_json_parse_error', { cause: e }));
    });

    parser.on('end', () => {
      if (!gotValue) {
        reject(new Error('stream_json_no_value'));
      }
    });

    parser.end(`${line}\n`, 'utf8');
  });
}
