import { useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

type WarningModalProps = Readonly<{
  open: boolean;
  title: string;
  description?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}>;

export function WarningModal({ open, title, description, onConfirm, onCancel }: WarningModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/20 bg-white/90 p-6 shadow-xl backdrop-blur-xl motion-safe:animate-[scale-in_180ms_ease-out] dark:border-white/10 dark:bg-slate-900/90"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="warning-modal-title"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
            <AlertTriangle className="size-5 text-amber-600 motion-safe:animate-[warning-bounce_1.5s_ease-in-out_infinite] dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <h2
              id="warning-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {title}
            </h2>
            {description ? (
              <div className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {description}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus-visible:shadow-[0_0_0_3px_rgba(96,165,250,0.2)]"
          >
            Anulează
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:bg-amber-600 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(245,158,11,0.3)] dark:bg-amber-600 dark:hover:bg-amber-700"
          >
            Aplică
          </button>
        </div>
      </div>
    </div>
  );
}
