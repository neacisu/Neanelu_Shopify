import type { ReactNode } from 'react';

type WarningModalProps = Readonly<{
  open: boolean;
  title: string;
  description?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}>;

export function WarningModal({ open, title, description, onConfirm, onCancel }: WarningModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
      <div className="w-full max-w-md rounded-md border border-muted/20 bg-background p-5 shadow-lg">
        <div className="text-base font-semibold">{title}</div>
        {description ? <div className="mt-2 text-sm text-muted">{description}</div> : null}
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-muted/20 px-4 py-2 text-sm hover:bg-muted/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-warning px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:opacity-90"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
