import { createHash } from 'node:crypto';

import { withTenantContext } from '@app/database';

export type FeatureFlagRow = Readonly<{
  flag_key: string;
  default_value: boolean;
  is_active: boolean;
  rollout_percentage: number | null;
  allowed_shop_ids: readonly string[] | null;
  blocked_shop_ids: readonly string[] | null;
}>;

export async function isFeatureFlagEnabled(params: {
  shopId: string;
  flagKey: string;
  /** Default when the flag row is missing. */
  fallback: boolean;
}): Promise<boolean> {
  return await withTenantContext(params.shopId, async (client) => {
    const res = await client.query<FeatureFlagRow>(
      `SELECT
         flag_key,
         default_value,
         is_active,
         rollout_percentage,
         allowed_shop_ids,
         blocked_shop_ids
       FROM feature_flags
       WHERE flag_key = $1
       LIMIT 1`,
      [params.flagKey]
    );

    const row = res.rows[0];
    if (!row) return params.fallback;

    if (!row.is_active) return row.default_value;

    const blocked = row.blocked_shop_ids ?? [];
    if (blocked.includes(params.shopId)) return false;

    const allowed = row.allowed_shop_ids ?? [];
    if (allowed.includes(params.shopId)) return true;

    const rollout = row.rollout_percentage ?? 0;
    if (rollout <= 0) return row.default_value;
    if (rollout >= 100) return true;

    const bucket = stableBucket(`${params.flagKey}:${params.shopId}`);
    return bucket < rollout;
  });
}

function stableBucket(input: string): number {
  // Deterministic 0..99 bucket.
  const hex = createHash('sha256').update(input, 'utf8').digest('hex');
  const first4 = hex.slice(0, 4);
  const n = Number.parseInt(first4, 16);
  return n % 100;
}
