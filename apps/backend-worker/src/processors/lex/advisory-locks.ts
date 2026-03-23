import { createHash } from 'node:crypto';

import { withTenantContext } from '@app/database';
import type { TenantClient } from './pipeline-types.js';

function toSignedInt32(hex: string): number {
  const unsigned = Number.parseInt(hex, 16) >>> 0;
  return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
}

function buildLockKeys(scope: string): readonly [number, number] {
  const digest = createHash('sha256').update(scope).digest('hex');
  return [toSignedInt32(digest.slice(0, 8)), toSignedInt32(digest.slice(8, 16))] as const;
}

export async function withLexAdvisoryLock<T>(params: {
  shopId: string;
  scope: string;
  fn: (client: TenantClient) => Promise<T>;
}): Promise<T> {
  return await withTenantContext(params.shopId, async (client) => {
    const [keyOne, keyTwo] = buildLockKeys(`${params.shopId}:${params.scope}`);
    const locked = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1, $2) AS locked`,
      [keyOne, keyTwo]
    );

    if (!locked.rows[0]?.locked) {
      throw new Error(`lex_advisory_lock_busy:${params.scope}`);
    }

    try {
      return await params.fn(client);
    } finally {
      await client
        .query(`SELECT pg_advisory_unlock($1, $2)`, [keyOne, keyTwo])
        .catch(() => undefined);
    }
  });
}
