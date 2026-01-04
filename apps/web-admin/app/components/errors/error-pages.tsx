import { useEffect } from 'react';
import { Link, useRevalidator } from 'react-router-dom';
import { FileQuestion, ServerCrash, WifiOff } from 'lucide-react';

import { reportUiError } from '../../utils/report-ui-error';

export function OfflinePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="inline-flex size-12 items-center justify-center rounded-xl bg-muted/10 text-muted">
        <WifiOff className="size-6" />
      </div>
      <h1 className="text-h2">Offline</h1>
      <p className="text-body text-muted">
        Conexiunea la internet pare indisponibilă. Verifică rețeaua și reîncearcă.
      </p>
      <p className="text-caption text-muted">
        Tip: după revenirea conexiunii, pagina se reia automat.
      </p>
    </div>
  );
}

export function RouteErrorPage({ status, statusText }: { status: number; statusText?: string }) {
  const revalidator = useRevalidator();

  const title = status === 404 ? 'Pagina nu a fost găsită' : 'A apărut o eroare';
  const message =
    status === 404
      ? 'Ruta accesată nu există sau a fost mutată.'
      : 'A apărut o problemă neașteptată. Poți încerca din nou.';

  useEffect(() => {
    // Best-effort logging (no stack traces requirement is about UI display; this is internal reporting).
    reportUiError(new Error(statusText ?? title), { source: 'route', status });
  }, [status, statusText, title]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <div className="inline-flex size-12 items-center justify-center rounded-xl bg-muted/10 text-muted">
          {status === 404 ? (
            <FileQuestion className="size-6" />
          ) : (
            <ServerCrash className="size-6" />
          )}
        </div>
        <div className="text-caption text-muted">Eroare {status}</div>
        <h1 className="mt-1 text-h2">{title}</h1>
        <p className="mt-2 text-body text-muted">{message}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {status !== 404 ? (
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-body text-background shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onClick={() => void revalidator.revalidate()}
          >
            Reîncearcă
          </button>
        ) : null}

        <Link
          to="/"
          className="rounded-md border border-muted/20 bg-background px-4 py-2 text-body text-foreground shadow-sm hover:bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
