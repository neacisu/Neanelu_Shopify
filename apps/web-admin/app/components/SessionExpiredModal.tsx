import { useMemo } from 'react';
import { KeyRound, RefreshCw, X } from 'lucide-react';

import { Modal } from './ui/modal.js';
import { Button } from './ui/button.js';

export function SessionExpiredModal(props: {
  open: boolean;
  shopDomain: string | null;
  onRefresh: () => void;
  onReauth: () => void;
  onClose: () => void;
}) {
  const { open, shopDomain, onRefresh, onReauth, onClose } = props;

  const title = 'Sesiunea a expirat';
  const message = useMemo(() => {
    return shopDomain
      ? `Token-ul de sesiune pentru ${shopDomain} nu mai este valid. Acest lucru se întâmplă de obicei după o perioadă de inactivitate sau dacă sesiunea a fost invalidată de server. Poți încerca să reîncarci pagina sau, dacă problema persistă, să te re-autentifici.`
      : 'Token-ul de sesiune nu mai este valid. Acest lucru se întâmplă de obicei după o perioadă de inactivitate. Poți încerca să reîncarci pagina sau să te re-autentifici.';
  }, [shopDomain]);

  return (
    <Modal open={open} onClose={onClose} className="p-0" aria-label={title}>
      <div className="flex items-start gap-4 border-b border-border/60 p-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15">
          <KeyRound className="size-5 text-warning" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={onClose}
          aria-label="Închide"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="p-5">
        <p className="text-sm leading-relaxed text-muted">{message}</p>
      </div>

      <div className="border-t border-border/60 p-5">
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onRefresh}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="size-4" />
              Reîncarcă pagina
            </span>
          </Button>
          <Button variant="primary" disabled={!shopDomain} onClick={onReauth}>
            Re-autentificare
          </Button>
        </div>
      </div>
    </Modal>
  );
}
