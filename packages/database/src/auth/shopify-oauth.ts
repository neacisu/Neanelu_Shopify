import type { Pool, PoolClient } from 'pg';

import { encryptAesGcm } from '../encryption/crypto.js';

export interface ShopifyTokenExchangeResult {
  access_token: string;
  scope: string;
}

export async function exchangeCodeForToken(params: {
  shopDomain: string;
  code: string;
  clientId: string;
  clientSecret: string;
}): Promise<ShopifyTokenExchangeResult> {
  const { shopDomain, code, clientId, clientSecret } = params;

  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Token exchange failed: ${response.status}${text ? ` ${text}` : ''}`);
  }

  return (await response.json()) as ShopifyTokenExchangeResult;
}

export function encryptShopifyAccessToken(params: {
  accessToken: string;
  encryptionKeyHex: string;
}): {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
} {
  const key = Buffer.from(params.encryptionKeyHex, 'hex');
  const tokenBuffer = Buffer.from(params.accessToken, 'utf-8');
  const encrypted = encryptAesGcm(tokenBuffer, key);

  return {
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag,
  };
}

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export async function upsertOfflineShopCredentials(params: {
  client: Queryable;
  shopDomain: string;
  encryptedToken: {
    ciphertext: Buffer;
    iv: Buffer;
    tag: Buffer;
  };
  keyVersion: number;
  scopes: string[];
}): Promise<{ shopId: string }> {
  const { client, shopDomain, encryptedToken, keyVersion, scopes } = params;

  const upsertShopResult = await client.query<{ id: string }>(
    `INSERT INTO shops (
       shopify_domain,
       access_token_ciphertext,
       access_token_iv,
       access_token_tag,
       key_version,
       scopes,
       installed_at,
       uninstalled_at
     ) VALUES ($1, $2, $3, $4, $5, $6, now(), NULL)
     ON CONFLICT (shopify_domain) DO UPDATE SET
       access_token_ciphertext = EXCLUDED.access_token_ciphertext,
       access_token_iv = EXCLUDED.access_token_iv,
       access_token_tag = EXCLUDED.access_token_tag,
       key_version = EXCLUDED.key_version,
       scopes = EXCLUDED.scopes,
       installed_at = COALESCE(shops.installed_at, now()),
       uninstalled_at = NULL,
       updated_at = now()
     RETURNING id`,
    [
      shopDomain,
      encryptedToken.ciphertext,
      encryptedToken.iv,
      encryptedToken.tag,
      keyVersion,
      scopes,
    ]
  );

  const shopId = upsertShopResult.rows[0]?.id;
  if (!shopId) {
    throw new Error('Failed to upsert shop credentials (missing shop id)');
  }

  // Defense-in-depth: also persist into shopify_tokens.
  // `shopify_tokens` has RLS enabled and requires `app.current_shop_id` to match `shop_id`.
  // Set tenant context in the *same statement* as the insert/upsert, to be robust even if a pooler
  // changes behavior (or when statements are replayed/parallelized).
  await client.query(
    `WITH _tenant AS (
       SELECT set_config('app.current_shop_id', $7, true)
     )
     INSERT INTO shopify_tokens (
       shop_id,
       access_token_ciphertext,
       access_token_iv,
       access_token_tag,
       key_version,
       scopes,
       rotated_at
     )
     SELECT
       $1::uuid,
       $2,
       $3,
       $4,
       $5,
       $6,
       NULL
     FROM _tenant
     ON CONFLICT (shop_id) DO UPDATE SET
       access_token_ciphertext = EXCLUDED.access_token_ciphertext,
       access_token_iv = EXCLUDED.access_token_iv,
       access_token_tag = EXCLUDED.access_token_tag,
       key_version = EXCLUDED.key_version,
       scopes = EXCLUDED.scopes,
       rotated_at = now()`,
    [
      shopId,
      encryptedToken.ciphertext,
      encryptedToken.iv,
      encryptedToken.tag,
      keyVersion,
      scopes,
      String(shopId),
    ]
  );

  return { shopId };
}
