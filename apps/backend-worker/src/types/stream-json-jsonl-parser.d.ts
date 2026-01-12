declare module 'stream-json/jsonl/Parser.js' {
  import { Transform } from 'node:stream';

  export default class JsonlParser extends Transform {
    constructor(options?: unknown);
  }
}
