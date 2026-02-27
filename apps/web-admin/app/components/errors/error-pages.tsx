import { useEffect } from 'react';
import { useRevalidator } from 'react-router-dom';
import { FileQuestion, RotateCcw, ServerCrash, WifiOff } from 'lucide-react';

import { reportUiError } from '../../utils/report-ui-error';
import { ShopifyLink } from '../../shopify';

export function OfflinePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-12 text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <WifiOff className="size-8" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Offline</h1>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        Conexiunea la internet pare indisponibilă. Verifică rețeaua și reîncearcă.
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-500">
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
    reportUiError(new Error(statusText ?? title), { source: 'route', status });
  }, [status, statusText, title]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-12">
      <div>
        <div className="inline-flex size-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {status === 404 ? (
            <FileQuestion className="size-8" />
          ) : (
            <ServerCrash className="size-8" />
          )}
        </div>
        <div className="mt-3 font-mono text-xs text-slate-500 dark:text-slate-500">
          Eroare {status}
        </div>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{message}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {status !== 404 ? (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:bg-primary/90 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] dark:text-slate-900 dark:focus-visible:shadow-[0_0_0_3px_rgba(96,165,250,0.2)]"
            onClick={() => void revalidator.revalidate()}
          >
            <RotateCcw className="size-4" />
            Reîncearcă
          </button>
        ) : null}

        <ShopifyLink
          to="/"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus-visible:shadow-[0_0_0_3px_rgba(96,165,250,0.2)]"
        >
          Acasă
        </ShopifyLink>
      </div>
    </div>
  );
}
