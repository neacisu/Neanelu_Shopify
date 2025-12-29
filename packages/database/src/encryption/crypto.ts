import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // bytes
const TAG_LENGTH = 16; // bytes

export interface EncryptResult {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function randomIv(): Buffer {
  return crypto.randomBytes(IV_LENGTH);
}

export function encryptAesGcm(
  plaintext: Buffer,
  key: Buffer,
  iv?: Buffer,
  aad?: Buffer
): EncryptResult {
  if (key.length !== 32) throw new Error('AES-256-GCM key must be 32 bytes');
  const ivBuf = iv ?? randomIv();
  const cipher = crypto.createCipheriv(ALGO, key, ivBuf, { authTagLength: TAG_LENGTH });
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv: ivBuf, tag };
}

export function decryptAesGcm(
  ciphertext: Buffer,
  key: Buffer,
  iv: Buffer,
  tag: Buffer,
  aad?: Buffer
): Buffer {
  if (key.length !== 32) throw new Error('AES-256-GCM key must be 32 bytes');
  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LENGTH });
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext;
}
