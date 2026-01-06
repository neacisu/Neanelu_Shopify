import { useEffect, useRef } from 'react';

import { PolarisButton } from '../../../components/polaris/index.js';

export type ConfirmDialogTone = 'critical' | 'primary' | 'secondary';

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: ConfirmDialogTone;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const {
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    confirmTone = 'critical',
    onConfirm,
    onCancel,
  } = props;

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
      onCancel();
    };

    dialog.addEventListener('cancel', onCancelEvent);
    return () => dialog.removeEventListener('cancel', onCancelEvent);
  }, [onCancel]);

  return (
    <dialog
      ref={dialogRef}
      className="w-[min(700px,calc(100vw-2rem))] rounded-lg border bg-background p-0 text-foreground shadow-xl"
      aria-label={title}
      onClose={onCancel}
    >
      <div className="flex items-start justify-between gap-4 border-b p-4">
        <div>
          <div className="text-h3">{title}</div>
        </div>
        <PolarisButton variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </PolarisButton>
      </div>

      <div className="p-4">
        <div className="text-sm text-foreground/90">{message}</div>
      </div>

      <div className="border-t p-4">
        <div className="flex items-center justify-end gap-2">
          <PolarisButton variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </PolarisButton>
          <PolarisButton variant={confirmTone} onClick={onConfirm}>
            {confirmLabel}
          </PolarisButton>
        </div>
      </div>
    </dialog>
  );
}
