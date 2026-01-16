import { loadEnv } from '@app/config';

export type BulkIngestConfig = Readonly<{
  copyBatchRows: number;
  copyBatchBytes: number;
  downloadHighWaterMarkBytes: number;
  mergeAnalyze: boolean;
  mergeAllowDeletes: boolean;
  stagingReindex: boolean;
}>;

export function getBulkIngestConfig(): BulkIngestConfig {
  const env = loadEnv();
  return {
    copyBatchRows: env.bulkCopyBatchRows,
    copyBatchBytes: env.bulkCopyBatchBytes,
    downloadHighWaterMarkBytes: env.bulkDownloadHighWaterMarkBytes,
    mergeAnalyze: env.bulkMergeAnalyze,
    mergeAllowDeletes: env.bulkMergeAllowDeletes,
    stagingReindex: env.bulkStagingReindex,
  };
}
