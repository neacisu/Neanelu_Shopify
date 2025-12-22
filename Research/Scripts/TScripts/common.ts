import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

export function assertNever(x: never, msg: string): never {
  throw new Error(msg);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ensureDirForFile(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!dir || dir === '.') return;
  fs.mkdirSync(dir, { recursive: true });
}

export function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

export function writeJsonFile(filePath: string, data: unknown): void {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function loadEnvFile(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const env: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key) env[key] = value;
  }

  return env;
}

export type GraphQLErrorItem = {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: Array<string | number>;
  extensions?: unknown;
};

export type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLErrorItem[];
  extensions?: any;
};

export async function gqlPost<T>(
  endpoint: string,
  token: string,
  query: string,
  variables: Record<string, unknown> | null,
  timeoutMs: number,
): Promise<GraphQLResponse<T>> {
  const payload = JSON.stringify({ query, variables });

  const url = new URL(endpoint);

  return await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-Shopify-Access-Token': token,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.from(d)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          try {
            resolve(JSON.parse(text) as GraphQLResponse<T>);
          } catch (e) {
            reject(new Error(`Invalid JSON from GraphQL (${res.statusCode}): ${text.slice(0, 500)}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`GraphQL request timed out after ${timeoutMs}ms`));
    });

    req.write(payload);
    req.end();
  });
}

// Deterministic PRNG (mulberry32) for stable sampling.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Python-compatible RNG (MT19937) to reproduce `random.Random(seed)` behavior.
// This is used so the TypeScript ports can match Python outputs exactly when given the same seed.
export class PythonRandom {
  private MT: number[] = new Array(624).fill(0);
  private index = 624;

  constructor(seed: number) {
    this.seed(seed);
  }

  seed(seed: number): void {
    // CPython-compatible seeding for integer seeds using init_by_array.
    // See CPython: Modules/_randommodule.c
    let x = Math.trunc(seed);
    if (!Number.isFinite(x)) x = 0;
    if (x < 0) x = -x;

    const key: number[] = [];
    let n = BigInt(x);
    while (n > 0n) {
      key.push(Number(n & 0xffffffffn));
      n >>= 32n;
    }
    if (key.length === 0) key.push(0);

    this.initByArray(key);
  }

  private initGenrand(s: number): void {
    this.MT[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const prev = this.MT[i - 1]!;
      this.MT[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
    }
    this.index = 624;
  }

  private initByArray(initKey: number[]): void {
    const keyLength = initKey.length;
    this.initGenrand(19650218);

    let i = 1;
    let j = 0;
    let k = 624 > keyLength ? 624 : keyLength;

    for (; k > 0; k--) {
      const prev = this.MT[i - 1]!;
      const cur = this.MT[i]!;
      const x = (prev ^ (prev >>> 30)) >>> 0;
      this.MT[i] = (cur ^ Math.imul(x, 1664525)) >>> 0;
      this.MT[i] = (this.MT[i]! + initKey[j]! + j) >>> 0;
      i += 1;
      j += 1;
      if (i >= 624) {
        this.MT[0] = this.MT[623]!;
        i = 1;
      }
      if (j >= keyLength) j = 0;
    }

    for (k = 623; k > 0; k--) {
      const prev = this.MT[i - 1]!;
      const cur = this.MT[i]!;
      const x = (prev ^ (prev >>> 30)) >>> 0;
      this.MT[i] = (cur ^ Math.imul(x, 1566083941)) >>> 0;
      this.MT[i] = (this.MT[i]! - i) >>> 0;
      i += 1;
      if (i >= 624) {
        this.MT[0] = this.MT[623]!;
        i = 1;
      }
    }

    this.MT[0] = 0x80000000;
    this.index = 624;
  }

  private twist(): void {
    for (let i = 0; i < 624; i++) {
      const y = ((this.MT[i]! & 0x80000000) + (this.MT[(i + 1) % 624]! & 0x7fffffff)) >>> 0;
      let v = (this.MT[(i + 397) % 624]! ^ (y >>> 1)) >>> 0;
      if (y % 2 !== 0) v = (v ^ 0x9908b0df) >>> 0;
      this.MT[i] = v;
    }
    this.index = 0;
  }

  // 32-bit unsigned int
  getrandbits32(): number {
    if (this.index >= 624) this.twist();
    let y = this.MT[this.index++]!;
    // temper
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  getrandbits(k: number): bigint {
    if (k <= 0) return 0n;
    let bits = 0n;
    let remaining = k;
    while (remaining > 0) {
      const r = BigInt(this.getrandbits32());
      const take = Math.min(32, remaining);
      bits = (bits << BigInt(take)) | (r >> BigInt(32 - take));
      remaining -= take;
    }
    return bits;
  }

  private bitLength(n: bigint): number {
    let x = n;
    let bits = 0;
    while (x > 0n) {
      x >>= 1n;
      bits += 1;
    }
    return bits;
  }

  randbelow(n: number): number {
    if (!(n > 0)) throw new Error('randbelow() requires n > 0');
    const nn = BigInt(n);
    const k = this.bitLength(nn - 1n);
    while (true) {
      const r = this.getrandbits(k);
      if (r < nn) return Number(r);
    }
  }

  randrange(stop: number): number {
    if (!(stop > 0)) throw new Error('randrange(stop) requires stop > 0');
    return this.randbelow(stop);
  }

  // Float in [0,1) roughly compatible with Python's random()
  random(): number {
    // Python uses 53 bits from two 32-bit ints.
    const a = this.getrandbits32() >>> 5; // 27 bits
    const b = this.getrandbits32() >>> 6; // 26 bits
    return (a * 67108864 + b) / 9007199254740992;
  }

  shuffleInPlace<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}

export type ParsedCli = {
  positional: string[];
  flags: Set<string>;
  values: Record<string, string>;
};

// Minimal CLI parser:
// - Supports positional args
// - Supports flags: --flag, -h
// - Supports key/values: --key value, --key=value
export function parseCli(argv: string[]): ParsedCli {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      flags.add('help');
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        const k = a.slice(2, eq).trim();
        const v = a.slice(eq + 1);
        if (k) values[k] = v;
        continue;
      }

      const key = a.slice(2).trim();
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        values[key] = next;
        i += 1;
      } else {
        flags.add(key);
      }
      continue;
    }

    if (a.startsWith('-') && a.length > 1) {
      // Treat short flags as a set of single-letter flags.
      for (const ch of a.slice(1)) flags.add(ch);
      continue;
    }

    positional.push(a);
  }

  return { positional, flags, values };
}
