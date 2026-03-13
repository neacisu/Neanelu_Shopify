import { useEffect } from 'react';
import { useRevalidator } from 'react-router-dom';
import { FileQuestion, RotateCcw, ServerCrash, WifiOff } from 'lucide-react';

import { reportUiError } from '../../utils/report-ui-error';
import { ShopifyLink } from '../../shopify';

export function OfflinePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-12 text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-subtle text-muted">
        <WifiOff className="size-8" />
      </div>
      <h1 className="text-2xl font-bold text-foreground">Offline</h1>
      <p className="text-sm leading-relaxed text-foreground">
        Conexiunea la internet pare indisponibilă. Verifică rețeaua și reîncearcă.
      </p>
      <p className="text-xs text-muted">Tip: după revenirea conexiunii, pagina se reia automat.</p>
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
    reportUiError(new Error(statusText ?? title), { source: 'route', status });
  }, [status, statusText, title]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-12">
      <div>
        <div className="inline-flex size-16 items-center justify-center rounded-2xl bg-subtle text-muted">
          {status === 404 ? (
            <FileQuestion className="size-8" />
          ) : (
            <ServerCrash className="size-8" />
          )}
        </div>
        <div className="mt-3 font-mono text-xs text-muted">Eroare {status}</div>
        <h1 className="mt-1 text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-foreground">{message}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {status !== 404 ? (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-[var(--shadow-sm)] transition-all duration-200 hover:bg-primary/90 focus-ring-standard"
            onClick={() => void revalidator.revalidate()}
          >
            <RotateCcw className="size-4" />
            Reîncearcă
          </button>
        ) : null}

        <ShopifyLink
          to="/"
          className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-[var(--shadow-sm)] transition-all duration-200 hover:bg-subtle focus-ring-standard"
        >
          Acasă
        </ShopifyLink>
      </div>
    </div>
  );
}
