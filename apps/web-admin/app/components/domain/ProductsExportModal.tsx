import { useEffect, useMemo, useState } from 'react';

import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';

type ExportFormat = 'csv' | 'json' | 'excel';

type ExportJob = Readonly<{
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  downloadUrl?: string;
  error?: string;
}>;

type ProductsExportModalProps = Readonly<{
  open: boolean;
  totalCount: number;
  onClose: () => void;
  onStartAsyncExport: (format: ExportFormat, options: ExportOptions) => Promise<ExportJob>;
  onPollAsyncExport: (jobId: string) => Promise<ExportJob>;
}>;

export type ExportOptions = Readonly<{
  columns: string[];
  includeVariants: boolean;
  applyFilters: boolean;
}>;

const defaultColumns = [
  'title',
  'sku',
  'vendor',
  'price',
  'quality_level',
  'gtin',
  'description',
  'metafields',
];

export function ProductsExportModal({
  open,
  totalCount,
  onClose,
  onStartAsyncExport,
  onPollAsyncExport,
}: ProductsExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [columns, setColumns] = useState<string[]>(['title', 'sku', 'vendor', 'price']);
  const [includeVariants, setIncludeVariants] = useState(true);
  const [applyFilters, setApplyFilters] = useState(true);
  const [job, setJob] = useState<ExportJob | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setJob(null);
      setLoading(false);
      setFormat('csv');
      setColumns(['title', 'sku', 'vendor', 'price']);
      setIncludeVariants(true);
      setApplyFilters(true);
    }
  }, [open]);

  useEffect(() => {
    if (!job) return;
    if (job.status !== 'queued' && job.status !== 'processing') return;
    const handle = window.setInterval(() => {
      void onPollAsyncExport(job.jobId).then((next) => setJob(next));
    }, 2000);
    return () => window.clearInterval(handle);
  }, [job, onPollAsyncExport]);

  const exportLabel = useMemo(() => {
    if (!job) return `Pornește export (${totalCount})`;
    if (job.status === 'completed') return 'Descarcă export';
    return 'Export în curs';
  }, [job, totalCount]);

  const toggleColumn = (column: string, checked: boolean) => {
    setColumns((prev) => (checked ? [...prev, column] : prev.filter((item) => item !== column)));
  };

  const onExport = async () => {
    setLoading(true);
    try {
      const created = await onStartAsyncExport(format, { columns, includeVariants, applyFilters });
      setJob(created);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="space-y-4 p-4 bg-card/80 backdrop-blur-sm rounded-lg">
        <div>
          <div className="text-h3">Export produse</div>
          <p className="text-body text-muted">
            Exportă {totalCount} produse cu filtrele curente aplicate.
          </p>
        </div>

        <div className="space-y-2 text-sm">
          <div className="text-caption text-muted">Format fișier</div>
          <label htmlFor="export-format-csv" className="flex items-center gap-2">
            <input
              id="export-format-csv"
              type="radio"
              name="export-format"
              value="csv"
              checked={format === 'csv'}
              className="accent-primary focus-ring-standard"
              onChange={() => setFormat('csv')}
            />
            CSV
          </label>
          <label htmlFor="export-format-json" className="flex items-center gap-2">
            <input
              id="export-format-json"
              type="radio"
              name="export-format"
              value="json"
              checked={format === 'json'}
              className="accent-primary focus-ring-standard"
              onChange={() => setFormat('json')}
            />
            JSON
          </label>
          <label htmlFor="export-format-excel" className="flex items-center gap-2">
            <input
              id="export-format-excel"
              type="radio"
              name="export-format"
              value="excel"
              checked={format === 'excel'}
              className="accent-primary focus-ring-standard"
              onChange={() => setFormat('excel')}
            />
            Excel
          </label>
        </div>

        <div className="space-y-2 text-sm">
          <div className="text-caption text-muted">Coloane</div>
          <div className="grid grid-cols-2 gap-2">
            {defaultColumns.map((column) => (
              <label
                key={column}
                htmlFor={`export-col-${column}`}
                className="flex items-center gap-2 text-xs"
              >
                <Checkbox
                  id={`export-col-${column}`}
                  checked={columns.includes(column)}
                  onChange={(e) => toggleColumn(column, e.target.checked)}
                />
                {column}
              </label>
            ))}
          </div>
        </div>

        <label
          htmlFor="export-include-variants"
          className="flex cursor-pointer items-center gap-2 text-sm transition-colors hover:text-foreground"
        >
          <Checkbox
            id="export-include-variants"
            checked={includeVariants}
            onChange={(e) => setIncludeVariants(e.target.checked)}
          />
          Include variante ca rânduri separate
        </label>

        <label
          htmlFor="export-apply-filters"
          className="flex cursor-pointer items-center gap-2 text-sm transition-colors hover:text-foreground"
        >
          <Checkbox
            id="export-apply-filters"
            checked={applyFilters}
            onChange={(e) => setApplyFilters(e.target.checked)}
          />
          Aplică filtrele curente
        </label>

        {job ? (
          <div className="rounded-md border border-border bg-muted/10 p-3 text-sm">
            <div className="text-caption text-muted">Status</div>
            <div className="text-sm capitalize">
              {job.status === 'queued'
                ? 'În coadă'
                : job.status === 'processing'
                  ? 'Se procesează'
                  : job.status === 'completed'
                    ? 'Finalizat'
                    : job.status === 'failed'
                      ? 'Eșuat'
                      : job.status}
            </div>
            {typeof job.progress === 'number' ? (
              <div className="mt-2">
                <div className="text-caption text-muted">Progress</div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded bg-muted/30">
                  <div
                    className="h-full bg-success"
                    style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                  />
                </div>
              </div>
            ) : null}
            {job.status === 'completed' && job.downloadUrl ? (
              <a
                href={job.downloadUrl}
                className="mt-3 inline-flex text-sm text-success transition-colors hover:text-success hover:underline"
              >
                Descarcă export
              </a>
            ) : null}
            {job.status === 'failed' && job.error ? (
              <div className="mt-2 text-xs text-error">{job.error}</div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Închide
          </Button>
          <Button variant="secondary" onClick={() => void onExport()} loading={loading}>
            {exportLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
