import { encryptAesGcm, decryptAesGcm } from './crypto.ts';
import { ACTIVE_KEY_VERSION, KEYS } from './keys.ts';
import type { ShopifyToken } from '../schema/shopify-tokens.ts';

export interface EncryptedToken {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
}

export function encryptToken(plaintext: string): EncryptedToken {
  const key = KEYS.get(ACTIVE_KEY_VERSION);
  if (!key) throw new Error(`Active encryption key v${ACTIVE_KEY_VERSION} not loaded`);
  const { ciphertext, iv, tag } = encryptAesGcm(Buffer.from(plaintext, 'utf8'), key.key);
  return { ciphertext, iv, tag, keyVersion: key.version };
}

export function decryptToken(row: ShopifyToken): string {
  const key = KEYS.get(row.keyVersion);
  if (!key) throw new Error(`Unknown key version ${row.keyVersion}`);
  const plaintext = decryptAesGcm(
    row.accessTokenCiphertext as Buffer,
    key.key,
    row.accessTokenIv as Buffer,
    row.accessTokenTag as Buffer
  );
  return plaintext.toString('utf8');
}
