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
