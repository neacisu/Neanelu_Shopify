import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { FileUpload } from '../components/ui/FileUpload';
import { InfoTooltip } from '../components/ui/info-tooltip';
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
      { label: 'Acasă', href: '/' },
      { label: 'Produse', href: '/products' },
      { label: 'Importare', href: location.pathname },
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
    <div className="space-y-6 dark:text-slate-100">
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader
        title="Import produse"
        description="Încarcă fișiere CSV sau JSON pentru import în masă."
      />

      <section className="rounded-lg border border-border dark:border-slate-700 bg-white dark:bg-slate-900/80 p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold dark:text-slate-100">
            Pasul 1: Încarcă fișierul
          </span>
          <InfoTooltip title="Format fișier">
            CSV: coloane title, sku, vendor, price etc. JSON/JSONL: array de obiecte produs. Max 50
            MB.
          </InfoTooltip>
        </div>
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

      <section className="rounded-lg border border-border dark:border-slate-700 bg-white dark:bg-slate-900/80 p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold dark:text-slate-100">
            Pasul 2: Previzualizare și validare
          </span>
          <InfoTooltip title="Validare">
            Verifică erorile pe rând înainte de import. Rândurile cu erori pot fi omise dacă „Omite
            erori” este bifat.
          </InfoTooltip>
        </div>
        {job ? (
          <div className="mt-3 space-y-2 text-sm">
            <div>
              Status:{' '}
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
            {job.summary ? (
              <div>
                Parse: {job.summary.total} | Valide: {job.summary.valid} | Erori:{' '}
                {job.summary.errors}
              </div>
            ) : null}
            {job.errors?.length ? (
              <div className="rounded-md border border-border dark:border-slate-700 bg-muted/10 dark:bg-slate-800/50 p-3 text-xs dark:text-slate-300">
                {job.errors.slice(0, 5).map((err) => (
                  <div key={`${err.row}-${err.message}`}>
                    Rând {err.row}: {err.message}
                  </div>
                ))}
              </div>
            ) : null}
            {job.previewRows?.length ? (
              <div className="overflow-hidden rounded-md border border-border dark:border-slate-700">
                <div className="grid grid-cols-4 gap-2 border-b border-border dark:border-slate-700 bg-muted/10 dark:bg-slate-800/50 px-3 py-2 text-xs font-semibold dark:text-slate-300">
                  <div>Rând</div>
                  <div>Titlu</div>
                  <div>SKU</div>
                  <div>Status</div>
                </div>
                {job.previewRows.map((row) => (
                  <div
                    key={`${row.row}-${row.error ?? 'ok'}`}
                    className={`grid grid-cols-4 gap-2 px-3 py-2 text-xs transition-colors ${
                      row.error ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300' : ''
                    }`}
                  >
                    <div>{row.row}</div>
                    <div>{row.data['title'] ?? '-'}</div>
                    <div>{row.data['sku'] ?? '-'}</div>
                    <div>{row.error ? `Eroare: ${row.error}` : 'OK'}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {job.error ? <div className="text-xs text-error">{job.error}</div> : null}
          </div>
        ) : (
          <div className="mt-2 text-xs text-muted dark:text-slate-400">
            Încarcă un fișier pentru a vedea rezultatele validării.
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border dark:border-slate-700 bg-white dark:bg-slate-900/80 p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold dark:text-slate-100">Pasul 3: Opțiuni</span>
          <InfoTooltip title="Opțiuni import">
            Opțiunile se aplică la următorul upload. Dry run doar previzualizează, fără salvare.
          </InfoTooltip>
        </div>
        <div className="mt-2 space-y-2 text-xs text-muted dark:text-slate-400">
          <label className="flex cursor-pointer items-center gap-2 transition-colors hover:text-foreground dark:hover:text-slate-200">
            <input
              type="checkbox"
              checked={options.dryRun}
              onChange={(e) => setOptions((prev) => ({ ...prev, dryRun: e.target.checked }))}
            />
            Dry run (doar previzualizare)
          </label>
          <label className="flex cursor-pointer items-center gap-2 transition-colors hover:text-foreground dark:hover:text-slate-200">
            <input
              type="checkbox"
              checked={options.skipErrors}
              onChange={(e) => setOptions((prev) => ({ ...prev, skipErrors: e.target.checked }))}
            />
            Omite rândurile cu erori
          </label>
          <label className="flex cursor-pointer items-center gap-2 transition-colors hover:text-foreground dark:hover:text-slate-200">
            <input
              type="checkbox"
              checked={options.updateExisting}
              onChange={(e) =>
                setOptions((prev) => ({ ...prev, updateExisting: e.target.checked }))
              }
            />
            Actualizează produsele existente
          </label>
          <label className="flex cursor-pointer items-center gap-2 transition-colors hover:text-foreground dark:hover:text-slate-200">
            <input
              type="checkbox"
              checked={options.triggerEnrichment}
              onChange={(e) =>
                setOptions((prev) => ({ ...prev, triggerEnrichment: e.target.checked }))
              }
            />
            Pornește îmbogățirea pentru produse noi
          </label>
          <div className="text-xs text-muted dark:text-slate-500">
            Opțiunile se aplică la următorul upload.
          </div>
        </div>
      </section>
    </div>
  );
}
