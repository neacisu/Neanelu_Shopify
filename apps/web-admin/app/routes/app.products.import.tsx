import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Card } from '../components/ui/card';
import { FileUpload } from '../components/ui/FileUpload';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { Checkbox } from '../components/ui/checkbox';
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
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader
        title="Import produse"
        description="Încarcă fișiere CSV sau JSON pentru import în masă."
      />

      <Card padding="md">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold">Pasul 1: Încarcă fișierul</span>
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
      </Card>

      <Card padding="md">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold">Pasul 2: Previzualizare și validare</span>
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
              <div className="rounded-md border border-border bg-muted/10 p-3 text-xs">
                {job.errors.slice(0, 5).map((err) => (
                  <div key={`${err.row}-${err.message}`}>
                    Rând {err.row}: {err.message}
                  </div>
                ))}
              </div>
            ) : null}
            {job.previewRows?.length ? (
              <div className="overflow-x-auto rounded-md border border-border">
                <div className="grid grid-cols-4 gap-2 border-b border-border bg-muted/10 px-3 py-2 text-xs font-semibold">
                  <div>Rând</div>
                  <div>Titlu</div>
                  <div>SKU</div>
                  <div>Status</div>
                </div>
                {job.previewRows.map((row) => (
                  <div
                    key={`${row.row}-${row.error ?? 'ok'}`}
                    className={`grid grid-cols-4 gap-2 px-3 py-2 text-xs transition-colors ${
                      row.error ? 'bg-error/5 text-error' : ''
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
          <div className="mt-2 text-xs text-muted">
            Încarcă un fișier pentru a vedea rezultatele validării.
          </div>
        )}
      </Card>

      <Card padding="md">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold">Pasul 3: Opțiuni</span>
          <InfoTooltip title="Opțiuni import">
            Opțiunile se aplică la următorul upload. Dry run doar previzualizează, fără salvare.
          </InfoTooltip>
        </div>
        <div className="mt-2 space-y-2 text-xs text-muted">
          <label className="flex cursor-pointer items-center gap-2 transition-colors hover:text-foreground">
            <Checkbox
              checked={options.dryRun}
              onChange={(e) => setOptions((prev) => ({ ...prev, dryRun: e.target.checked }))}
            />
            Dry run (doar previzualizare)
          </label>
          <label className="flex cursor-pointer items-center gap-2 transition-colors hover:text-foreground">
            <Checkbox
              checked={options.skipErrors}
              onChange={(e) => setOptions((prev) => ({ ...prev, skipErrors: e.target.checked }))}
            />
            Omite rândurile cu erori
          </label>
          <label className="flex cursor-pointer items-center gap-2 transition-colors hover:text-foreground">
            <Checkbox
              checked={options.updateExisting}
              onChange={(e) =>
                setOptions((prev) => ({ ...prev, updateExisting: e.target.checked }))
              }
            />
            Actualizează produsele existente
          </label>
          <label className="flex cursor-pointer items-center gap-2 transition-colors hover:text-foreground">
            <Checkbox
              checked={options.triggerEnrichment}
              onChange={(e) =>
                setOptions((prev) => ({ ...prev, triggerEnrichment: e.target.checked }))
              }
            />
            Pornește îmbogățirea pentru produse noi
          </label>
          <div className="text-xs text-muted">Opțiunile se aplică la următorul upload.</div>
        </div>
      </Card>
    </div>
  );
}
