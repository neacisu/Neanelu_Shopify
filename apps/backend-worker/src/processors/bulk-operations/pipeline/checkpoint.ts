import { withTenantContext } from '@app/database';

export type BulkIngestCheckpointV1 = Readonly<{
  version: 1;
  /** How many stitched records have been fully committed to staging. */
  committedRecords: number;
  committedProducts: number;
  committedVariants: number;
  lastCommitAtIso: string;
  /** True when deletes are safe to apply (full snapshot boundary). */
  isFullSnapshot: boolean;
}>;

export type BulkIngestCheckpointV2 = Readonly<{
  version: 2;
  /** How many stitched records have been fully committed to staging. */
  committedRecords: number;
  committedProducts: number;
  committedVariants: number;
  /** Bytes consumed from the JSONL stream (best-effort Range resume offset for identity streams). */
  committedBytes: number;
  /** Total JSONL lines observed up to the last commit (for audit/diagnostics). */
  committedLines: number;
  /** Last successfully processed entity identifier (best-effort). */
  lastSuccessfulId: string | null;
  lastCommitAtIso: string;
  /** True when deletes are safe to apply (full snapshot boundary). */
  isFullSnapshot: boolean;
}>;

export type BulkIngestCheckpoint = BulkIngestCheckpointV1 | BulkIngestCheckpointV2;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function readIngestCheckpoint(cursorState: unknown): BulkIngestCheckpoint | null {
  if (!isObject(cursorState)) return null;
  const ingest = cursorState['ingest'];
  if (!isObject(ingest)) return null;
  const checkpoint = ingest['checkpoint'];
  if (!isObject(checkpoint)) return null;

  const version = checkpoint['version'];
  if (version !== 1 && version !== 2) return null;

  const committedRecords = checkpoint['committedRecords'];
  const committedProducts = checkpoint['committedProducts'];
  const committedVariants = checkpoint['committedVariants'];
  const lastCommitAtIso = checkpoint['lastCommitAtIso'];
  const isFullSnapshot = checkpoint['isFullSnapshot'];

  if (typeof committedRecords !== 'number' || !Number.isFinite(committedRecords)) return null;
  if (typeof committedProducts !== 'number' || !Number.isFinite(committedProducts)) return null;
  if (typeof committedVariants !== 'number' || !Number.isFinite(committedVariants)) return null;
  if (typeof lastCommitAtIso !== 'string' || !lastCommitAtIso) return null;
  if (typeof isFullSnapshot !== 'boolean') return null;

  if (version === 1) {
    return {
      version: 1,
      committedRecords: Math.max(0, Math.trunc(committedRecords)),
      committedProducts: Math.max(0, Math.trunc(committedProducts)),
      committedVariants: Math.max(0, Math.trunc(committedVariants)),
      lastCommitAtIso,
      isFullSnapshot,
    };
  }

  const committedBytes = checkpoint['committedBytes'];
  const committedLines = checkpoint['committedLines'];
  const lastSuccessfulId = checkpoint['lastSuccessfulId'];

  if (typeof committedBytes !== 'number' || !Number.isFinite(committedBytes)) return null;
  if (typeof committedLines !== 'number' || !Number.isFinite(committedLines)) return null;
  if (lastSuccessfulId !== null && typeof lastSuccessfulId !== 'string') return null;

  return {
    version: 2,
    committedRecords: Math.max(0, Math.trunc(committedRecords)),
    committedProducts: Math.max(0, Math.trunc(committedProducts)),
    committedVariants: Math.max(0, Math.trunc(committedVariants)),
    committedBytes: Math.max(0, Math.trunc(committedBytes)),
    committedLines: Math.max(0, Math.trunc(committedLines)),
    lastSuccessfulId,
    lastCommitAtIso,
    isFullSnapshot,
  };
}

export async function persistIngestCheckpoint(params: {
  shopId: string;
  bulkRunId: string;
  recordsProcessed: number;
  bytesProcessed: number;
  checkpoint: BulkIngestCheckpoint;
}): Promise<void> {
  const checkpointJson = {
    ingest: {
      checkpoint: params.checkpoint,
    },
  };

  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET records_processed = GREATEST(records_processed, $1::int),
           bytes_processed = GREATEST(bytes_processed, $2::bigint),
           cursor_state = COALESCE(cursor_state, '{}'::jsonb) || $3::jsonb,
           updated_at = now()
       WHERE id = $4
         AND shop_id = $5`,
      [
        Math.max(0, Math.trunc(params.recordsProcessed)),
        Math.max(0, Math.trunc(params.bytesProcessed)),
        JSON.stringify(checkpointJson),
        params.bulkRunId,
        params.shopId,
      ]
    );
  });
}
