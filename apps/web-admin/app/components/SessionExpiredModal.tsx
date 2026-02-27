import { useEffect, useMemo, useRef } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';

import { Button } from './ui/button';

export function SessionExpiredModal(props: {
  open: boolean;
  shopDomain: string | null;
  onRefresh: () => void;
  onReauth: () => void;
  onClose: () => void;
}) {
  const { open, shopDomain, onRefresh, onReauth, onClose } = props;

  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    }

    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const onCancelEvent = (e: Event) => {
      e.preventDefault();
      onClose();
    };

    dialog.addEventListener('cancel', onCancelEvent);
    return () => dialog.removeEventListener('cancel', onCancelEvent);
  }, [onClose]);

  const title = 'Sesiunea a expirat';
  const message = useMemo(() => {
    return shopDomain
      ? `Token-ul de sesiune pentru ${shopDomain} nu mai este valid. Acest lucru se întâmplă de obicei după o perioadă de inactivitate sau dacă sesiunea a fost invalidată de server. Poți încerca să reîncarci pagina sau, dacă problema persistă, să te re-autentifici.`
      : 'Token-ul de sesiune nu mai este valid. Acest lucru se întâmplă de obicei după o perioadă de inactivitate. Poți încerca să reîncarci pagina sau să te re-autentifici.';
  }, [shopDomain]);

  return (
    <dialog
      ref={dialogRef}
      className="w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-white/20 bg-white/90 p-0 shadow-xl backdrop-blur-xl motion-safe:animate-[scale-in_180ms_ease-out] dark:border-white/10 dark:bg-slate-900/90 backdrop:bg-black/30 backdrop:backdrop-blur-sm"
      aria-label={title}
      onClose={onClose}
    >
      <div className="flex items-start gap-4 border-b border-slate-200/80 p-5 dark:border-slate-700/80">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/40">
          <KeyRound className="size-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1 text-muted transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Închide"
        >
          ✕
        </button>
      </div>

      <div className="p-5">
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{message}</p>
      </div>

      <div className="border-t border-slate-200/80 p-5 dark:border-slate-700/80">
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onRefresh}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="size-4" />
              Reîncarcă pagina
            </span>
          </Button>
          <Button
            variant="primary"
            disabled={!shopDomain}
            onClick={onReauth}
            className="bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
          >
            Re-autentificare
          </Button>
        </div>
      </div>
    </dialog>
  );
}
