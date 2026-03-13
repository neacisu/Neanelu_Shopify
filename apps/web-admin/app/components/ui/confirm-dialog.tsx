/**
 * Compatibility re-export - use domain/confirm-dialog for new code.
 * This wrapper maps the older `description`/`onClose`/`destructive` API
 * to the canonical domain ConfirmDialog.
 */
import {
  ConfirmDialog as DomainConfirmDialog,
  type ConfirmDialogTone,
} from '../domain/confirm-dialog.js';

export type ConfirmDialogProps = Readonly<{
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}>;

export function ConfirmDialog({
  description,
  destructive = false,
  onClose,
  ...rest
}: ConfirmDialogProps) {
  const tone: ConfirmDialogTone = destructive ? 'critical' : 'primary';
  return (
    <DomainConfirmDialog
      message={description ?? ''}
      confirmTone={tone}
      onCancel={onClose}
      {...rest}
    />
  );
}
