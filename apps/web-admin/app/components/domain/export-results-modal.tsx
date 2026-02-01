import { useEffect, useMemo, useState } from 'react';

import type { ProductSearchResult } from '@app/types';

import { PolarisModal } from '../../../components/polaris/index.js';
import { exportToCSV, exportToJSON, copyJsonToClipboard } from '../../utils/export-helpers';
import { Button } from '../ui/button';

type ExportFormat = 'csv' | 'json';

type ExportJob = Readonly<{
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  downloadUrl?: string;
  error?: string;
}>;

type ExportResultsModalProps = Readonly<{
  open: boolean;
  results: ProductSearchResult[];
  totalCount: number;
  onClose: () => void;
  onStartAsyncExport?: (format: ExportFormat) => Promise<ExportJob>;
  onPollAsyncExport?: (jobId: string) => Promise<ExportJob>;
  onCancelAsyncExport?: (jobId: string) => Promise<void>;
}>;

export function ExportResultsModal({
  open,
  results,
  totalCount,
  onClose,
  onStartAsyncExport,
  onPollAsyncExport,
  onCancelAsyncExport,
}: ExportResultsModalProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [job, setJob] = useState<ExportJob | null>(null);
  const [loading, setLoading] = useState(false);

  const isAsync = totalCount >= 1000;

  useEffect(() => {
    if (!open) {
      setJob(null);
      setLoading(false);
      setFormat('csv');
    }
  }, [open]);

  useEffect(() => {
    if (!job) return;
    if (job.status !== 'queued' && job.status !== 'processing') return;
    if (!onPollAsyncExport) return;

    const handle = window.setInterval(() => {
      void onPollAsyncExport(job.jobId).then((next) => {
        setJob(next);
      });
    }, 2000);

    return () => window.clearInterval(handle);
  }, [job, onPollAsyncExport]);

  const exportLabel = useMemo(() => {
    if (!isAsync) return `Export ${results.length} results`;
    if (!job) return `Start export (${totalCount} results)`;
    if (job.status === 'completed') return 'Download export';
    return 'Export in progress';
  }, [isAsync, job, results.length, totalCount]);

  const onExport = async () => {
    if (!isAsync) {
      if (format === 'csv') {
        exportToCSV(results, 'search-results.csv');
      } else {
        exportToJSON(results, 'search-results.json');
      }
      return;
    }

    if (!onStartAsyncExport) return;
    setLoading(true);
    try {
      const created = await onStartAsyncExport(format);
      setJob(created);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PolarisModal open={open} onClose={onClose}>
      <div className="space-y-4 p-4">
        <div>
          <div className="text-h3">Export results</div>
          <p className="text-body text-muted">
            {isAsync
              ? `Large export (${totalCount} results). The export will run in the background.`
              : `Download ${results.length} results instantly.`}
          </p>
        </div>

        <div className="space-y-2 text-sm">
          <div className="text-caption text-muted">Format</div>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="export-format"
              value="csv"
              checked={format === 'csv'}
              onChange={() => setFormat('csv')}
            />
            CSV
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="export-format"
              value="json"
              checked={format === 'json'}
              onChange={() => setFormat('json')}
            />
            JSON
          </label>
        </div>

        {job ? (
          <div className="rounded-md border bg-muted/10 p-3 text-sm">
            <div className="text-caption text-muted">Status</div>
            <div className="text-sm capitalize">{job.status}</div>
            {typeof job.progress === 'number' ? (
              <div className="mt-2">
                <div className="text-caption text-muted">Progress</div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded bg-muted/30">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                  />
                </div>
              </div>
            ) : null}
            {job.status === 'completed' && job.downloadUrl ? (
              <a
                href={job.downloadUrl}
                className="mt-3 inline-flex text-sm text-emerald-600 hover:underline"
              >
                Download export
              </a>
            ) : null}
            {job.status === 'failed' && job.error ? (
              <div className="mt-2 text-xs text-red-600">{job.error}</div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Close
          </Button>
          {format === 'json' ? (
            <Button
              variant="ghost"
              onClick={() => void copyJsonToClipboard(results)}
              disabled={loading || results.length === 0}
            >
              Copy JSON
            </Button>
          ) : null}
          {job?.status && onCancelAsyncExport && job.status !== 'completed' ? (
            <Button
              variant="destructive"
              onClick={() => void onCancelAsyncExport(job.jobId)}
              disabled={loading}
            >
              Cancel
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => void onExport()}
            loading={loading}
            disabled={results.length === 0}
          >
            {exportLabel}
          </Button>
        </div>
      </div>
    </PolarisModal>
  );
}
