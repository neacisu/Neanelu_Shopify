import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './modal.js';
import { Button } from './button.js';

export type WarningModalProps = Readonly<{
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}>;

export function WarningModal({
  open,
  title,
  description,
  confirmLabel = 'Aplică',
  cancelLabel = 'Anulează',
  onConfirm,
  onCancel,
}: WarningModalProps) {
  return (
    <Modal open={open} onClose={onCancel} className="p-6">
      <div role="alertdialog" aria-labelledby="warning-modal-title">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/15">
            <AlertTriangle className="size-5 text-warning motion-safe:animate-[warning-bounce_1.5s_ease-in-out_infinite]" />
          </div>
          <div className="min-w-0">
            <h2 id="warning-modal-title" className="text-base font-semibold text-foreground">
              {title}
            </h2>
            {description ? (
              <div className="mt-1.5 text-sm leading-relaxed text-muted">{description}</div>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
