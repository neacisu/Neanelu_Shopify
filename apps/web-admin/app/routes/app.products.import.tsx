import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { FileUpload } from '../components/ui/FileUpload';
import { useApiClient } from '../hooks/use-api';

type ImportJob = Readonly<{
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  summary?: { total: number; valid: number; errors: number };
  errors?: { row: number; message: string }[];
  previewRows?: { row: number; data: Record<string, string>; error?: string }[];
  error?: string;
}>;

export default function ProductsImportPage() {
  const location = useLocation();
  const api = useApiClient();
  const [job, setJob] = useState<ImportJob | null>(null);
  const [polling, setPolling] = useState(false);
  const [options, setOptions] = useState({
    dryRun: true,
    skipErrors: true,
    updateExisting: false,
    triggerEnrichment: false,
  });

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Products', href: '/products' },
      { label: 'Import', href: location.pathname },
    ],
    [location.pathname]
  );

  useEffect(() => {
    if (!job) return;
    if (job.status === 'completed' || job.status === 'failed') return;
    if (polling) return;
    setPolling(true);

    const handle = window.setInterval(() => {
      void api.getApi<ImportJob>(`/products/import/${job.jobId}`).then((next) => {
        setJob(next);
        if (next.status === 'completed' || next.status === 'failed') {
          window.clearInterval(handle);
          setPolling(false);
        }
      });
    }, 1500);

    return () => {
      window.clearInterval(handle);
      setPolling(false);
    };
  }, [api, job, polling]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader title="Import Products" description="Upload CSV or JSON files for bulk import." />

      <section className="rounded-lg border bg-background p-4">
        <div className="text-sm font-semibold">Step 1: Upload file</div>
        <FileUpload
          maxFiles={1}
          accept={{
            'text/csv': ['.csv'],
            'application/json': ['.json', '.jsonl'],
          }}
          maxSize={50 * 1024 * 1024}
          onUpload={async (file, apiHelpers) => {
            const body = new FormData();
            body.append('file', file);
            body.append('dryRun', String(options.dryRun));
            body.append('skipErrors', String(options.skipErrors));
            body.append('updateExisting', String(options.updateExisting));
            body.append('triggerEnrichment', String(options.triggerEnrichment));
            const response = await fetch('/api/products/import', {
              method: 'POST',
              body,
            });
            if (!response.ok) {
              apiHelpers.setError('Upload failed');
              return;
            }
            const data = (await response.json()) as { data?: { jobId: string; status: string } };
            const jobId = data.data?.jobId;
            if (!jobId) {
              apiHelpers.setError('Import job failed');
              return;
            }
            setJob({ jobId, status: 'queued' });
            apiHelpers.setDone();
          }}
        />
      </section>

      <section className="rounded-lg border bg-background p-4">
        <div className="text-sm font-semibold">Step 2: Preview & Validation</div>
        {job ? (
          <div className="mt-3 space-y-2 text-sm">
            <div>Status: {job.status}</div>
            {job.summary ? (
              <div>
                Parsed: {job.summary.total} | Valid: {job.summary.valid} | Errors:{' '}
                {job.summary.errors}
              </div>
            ) : null}
            {job.errors?.length ? (
              <div className="rounded-md border bg-muted/10 p-3 text-xs">
                {job.errors.slice(0, 5).map((err) => (
                  <div key={`${err.row}-${err.message}`}>
                    Row {err.row}: {err.message}
                  </div>
                ))}
              </div>
            ) : null}
            {job.previewRows?.length ? (
              <div className="overflow-hidden rounded-md border">
                <div className="grid grid-cols-4 gap-2 border-b bg-muted/10 px-3 py-2 text-xs font-semibold">
                  <div>Row</div>
                  <div>Title</div>
                  <div>SKU</div>
                  <div>Status</div>
                </div>
                {job.previewRows.map((row) => (
                  <div
                    key={`${row.row}-${row.error ?? 'ok'}`}
                    className={`grid grid-cols-4 gap-2 px-3 py-2 text-xs ${
                      row.error ? 'bg-red-50 text-red-700' : ''
                    }`}
                  >
                    <div>{row.row}</div>
                    <div>{row.data['title'] ?? '-'}</div>
                    <div>{row.data['sku'] ?? '-'}</div>
                    <div>{row.error ? `Error: ${row.error}` : 'OK'}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {job.error ? <div className="text-xs text-red-600">{job.error}</div> : null}
          </div>
        ) : (
          <div className="mt-2 text-xs text-muted">Upload a file to see validation results.</div>
        )}
      </section>

      <section className="rounded-lg border bg-background p-4">
        <div className="text-sm font-semibold">Step 3: Options</div>
        <div className="mt-2 space-y-2 text-xs text-muted">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={options.dryRun}
              onChange={(e) => setOptions((prev) => ({ ...prev, dryRun: e.target.checked }))}
            />
            Dry run (preview only)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={options.skipErrors}
              onChange={(e) => setOptions((prev) => ({ ...prev, skipErrors: e.target.checked }))}
            />
            Skip rows with errors
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={options.updateExisting}
              onChange={(e) =>
                setOptions((prev) => ({ ...prev, updateExisting: e.target.checked }))
              }
            />
            Update existing products
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={options.triggerEnrichment}
              onChange={(e) =>
                setOptions((prev) => ({ ...prev, triggerEnrichment: e.target.checked }))
              }
            />
            Trigger enrichment for new products
          </label>
          <div className="text-xs text-muted">Options apply to the next upload.</div>
        </div>
      </section>
    </div>
  );
}
