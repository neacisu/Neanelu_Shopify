import { withTenantContext } from '@app/database';

export async function saveLexCheckpoint(params: {
  shopId: string;
  runId: string;
  shardId?: string | null;
  workerName: string;
  checkpointType: string;
  checkpointValue: Record<string, unknown>;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `INSERT INTO lex_checkpoints
         (run_id, shard_id, shop_id, worker_name, checkpoint_type, checkpoint_value, heartbeat_at, status, created_at, updated_at)
       VALUES
         ($1, $2, $3, $4, $5, $6::jsonb, now(), 'active', now(), now())
       ON CONFLICT (run_id, worker_name, checkpoint_type)
       DO UPDATE
          SET shard_id = EXCLUDED.shard_id,
              checkpoint_value = EXCLUDED.checkpoint_value,
              heartbeat_at = now(),
              status = 'active',
              updated_at = now()`,
      [
        params.runId,
        params.shardId ?? null,
        params.shopId,
        params.workerName,
        params.checkpointType,
        JSON.stringify(params.checkpointValue),
      ]
    );
  });
}

export async function loadLexCheckpoint(params: {
  shopId: string;
  runId: string;
  workerName: string;
  checkpointType: string;
}): Promise<{
  shardId: string | null;
  checkpointValue: Record<string, unknown>;
  heartbeatAt: Date;
} | null> {
  let result: {
    rows: {
      shard_id: string | null;
      checkpoint_value: Record<string, unknown>;
      heartbeat_at: Date;
    }[];
  } | null = null;
  await withTenantContext(params.shopId, async (client) => {
    result = await client.query<{
      shard_id: string | null;
      checkpoint_value: Record<string, unknown>;
      heartbeat_at: Date;
    }>(
      `SELECT shard_id, checkpoint_value, heartbeat_at
       FROM lex_checkpoints
       WHERE shop_id = $1
         AND run_id = $2
         AND worker_name = $3
         AND checkpoint_type = $4
         AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [params.shopId, params.runId, params.workerName, params.checkpointType]
    );
  });
  if (!result) return null;
  const row = (
    result as {
      rows: {
        shard_id: string | null;
        checkpoint_value: Record<string, unknown>;
        heartbeat_at: Date;
      }[];
    }
  ).rows[0];
  if (!row) return null;
  return {
    shardId: row.shard_id,
    checkpointValue: row.checkpoint_value,
    heartbeatAt: row.heartbeat_at,
  };
}

export async function heartbeatLexCheckpoint(params: {
  shopId: string;
  runId: string;
  workerName: string;
  checkpointType: string;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE lex_checkpoints
       SET heartbeat_at = now(),
           updated_at = now()
       WHERE shop_id = $1
         AND run_id = $2
         AND worker_name = $3
         AND checkpoint_type = $4`,
      [params.shopId, params.runId, params.workerName, params.checkpointType]
    );
  });
}
