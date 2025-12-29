/**
 * Script de rotație cheie pentru shopify_tokens
 *
 * Pași:
 * 1) Setează ENCRYPTION_KEY_VERSION la noua versiune + cheia nouă (OpenBAO)
 * 2) Rulează acest script pentru a re-cripta token-urile existente
 *
 * NOTĂ: Nu șterge cheile vechi până când toate token-urile au fost re-criptate.
 */

import { pool } from '../src/db.ts';
import { decryptToken, encryptToken } from '../src/encryption/tokens.ts';
import type { ShopifyToken } from '../src/schema/shopify-tokens.ts';

interface TokenRow {
  id: string;
  accessTokenCiphertext: Buffer;
  accessTokenIv: Buffer;
  accessTokenTag: Buffer;
  keyVersion: number;
}

async function rotate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<TokenRow>(
      `SELECT
         id,
         access_token_ciphertext AS "accessTokenCiphertext",
         access_token_iv AS "accessTokenIv",
         access_token_tag AS "accessTokenTag",
         key_version AS "keyVersion"
       FROM shopify_tokens`
    );

    for (const row of res.rows) {
      const token: ShopifyToken = {
        id: row.id,
        shopId: '' as string,
        accessTokenCiphertext: row.accessTokenCiphertext,
        accessTokenIv: row.accessTokenIv,
        accessTokenTag: row.accessTokenTag,
        keyVersion: row.keyVersion,
        scopes: [],
        createdAt: new Date(),
        rotatedAt: null,
      };

      const plaintext = decryptToken(token);

      const enc = encryptToken(plaintext);
      await client.query(
        `
        UPDATE shopify_tokens
        SET access_token_ciphertext = $1,
            access_token_iv = $2,
            access_token_tag = $3,
            key_version = $4,
            rotated_at = now()
        WHERE id = $5
      `,
        [enc.ciphertext, enc.iv, enc.tag, enc.keyVersion, row.id]
      );
    }

    await client.query('COMMIT');
    console.info(
      `Rotated ${res.rowCount} tokens to key version ${process.env.ENCRYPTION_KEY_VERSION ?? 'N/A'}`
    );
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Rotation failed:', e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

void rotate();
