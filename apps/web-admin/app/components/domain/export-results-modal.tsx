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
    if (!isAsync) return `Exportă ${results.length} rezultate`;
    if (!job) return `Pornește export (${totalCount} rezultate)`;
    if (job.status === 'completed') return 'Descarcă export';
    return 'Export în curs';
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
          <h2 className="text-lg font-semibold text-slate-800">Export rezultate</h2>
          <p className="mt-1 text-sm text-slate-500">
            {isAsync
              ? `Export mare (${totalCount} rezultate). Exportul rulează în fundal.`
              : `Descarcă ${results.length} rezultate instant.`}
          </p>
        </div>

        <div className="space-y-2 text-sm">
          <div className="text-xs font-medium text-slate-500">Format</div>
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
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-sm">
            <div className="text-xs font-medium text-slate-500">Status</div>
            <div className="mt-0.5 text-sm text-slate-700">
              {job.status === 'queued'
                ? 'În coadă'
                : job.status === 'processing'
                  ? 'În curs'
                  : job.status === 'completed'
                    ? 'Finalizat'
                    : job.status === 'failed'
                      ? 'Eșuat'
                      : job.status}
            </div>
            {typeof job.progress === 'number' ? (
              <div className="mt-2">
                <div className="text-xs font-medium text-slate-500">Progres</div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                  />
                </div>
              </div>
            ) : null}
            {job.status === 'completed' && job.downloadUrl ? (
              <a
                href={job.downloadUrl}
                className="mt-3 inline-flex text-sm font-medium text-emerald-600 hover:underline"
              >
                Descarcă export
              </a>
            ) : null}
            {job.status === 'failed' && job.error ? (
              <div className="mt-2 text-xs text-red-600">{job.error}</div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Închide
          </Button>
          {format === 'json' ? (
            <Button
              variant="ghost"
              onClick={() => void copyJsonToClipboard(results)}
              disabled={loading || results.length === 0}
            >
              Copiază JSON
            </Button>
          ) : null}
          {job?.status && onCancelAsyncExport && job.status !== 'completed' ? (
            <Button
              variant="destructive"
              onClick={() => void onCancelAsyncExport(job.jobId)}
              disabled={loading}
            >
              Anulare
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
