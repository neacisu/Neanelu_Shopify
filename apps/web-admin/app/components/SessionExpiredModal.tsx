import { useEffect, useMemo, useRef } from 'react';

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
      ? `Token-ul de sesiune nu mai este valid pentru ${shopDomain}. Poți încerca refresh sau re-autentificare.`
      : 'Token-ul de sesiune nu mai este valid. Poți încerca refresh sau re-autentificare.';
  }, [shopDomain]);

  return (
    <dialog
      ref={dialogRef}
      className="w-[min(700px,calc(100vw-2rem))] rounded-lg border bg-background p-0 text-foreground shadow-xl"
      aria-label={title}
      onClose={onClose}
    >
      <div className="flex items-start justify-between gap-4 border-b p-4">
        <div>
          <div className="text-h3">{title}</div>
        </div>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="p-4">
        <div className="text-sm text-foreground/90">{message}</div>
      </div>

      <div className="border-t p-4">
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onRefresh}>
            Refresh
          </Button>
          <Button variant="destructive" disabled={!shopDomain} onClick={onReauth}>
            Re-auth
          </Button>
        </div>
      </div>
    </dialog>
  );
}
