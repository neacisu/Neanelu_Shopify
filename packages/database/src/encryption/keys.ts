import assert from 'node:assert';

export interface EncryptionKey {
  version: number;
  key: Buffer;
  createdAt?: Date;
  deprecated?: boolean;
}

function readKey(envVar: string | undefined): Buffer | null {
  if (!envVar) return null;
  const buf = Buffer.from(envVar, envVar.startsWith('base64:') ? 'base64' : 'hex');
  return buf.length === 32 ? buf : null;
}

export function loadKeysFromEnv(): Map<number, EncryptionKey> {
  const map = new Map<number, EncryptionKey>();

  const activeVersion = Number(process.env['ENCRYPTION_KEY_VERSION'] ?? 1);
  interface Candidate {
    version: number;
    value: string | undefined;
  }
  const candidates: Candidate[] = [
    { version: 1, value: process.env['ENCRYPTION_KEY_V1'] },
    { version: 2, value: process.env['ENCRYPTION_KEY_V2'] },
    { version: 3, value: process.env['ENCRYPTION_KEY_V3'] },
  ];

  for (const c of candidates) {
    const keyBuf = readKey(c.value);
    if (keyBuf) {
      map.set(c.version, {
        version: c.version,
        key: keyBuf,
        deprecated: c.version < activeVersion,
      });
    }
  }

  assert(map.has(activeVersion), `Missing active encryption key version ${activeVersion}`);

  return map;
}

export const ACTIVE_KEY_VERSION = Number(process.env['ENCRYPTION_KEY_VERSION'] ?? 1);
export const KEYS = loadKeysFromEnv();
