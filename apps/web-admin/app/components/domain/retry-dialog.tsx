import { useEffect, useRef, useState } from 'react';

import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';

export type RetryDialogProps = Readonly<{
  open: boolean;
  runId?: string | null;
  checkpointLabel?: string | null;
  recordsProcessed?: number | null;
  onCancel: () => void;
  onConfirm: (mode: 'resume' | 'restart') => void;
  loading?: boolean;
}>;

export function RetryDialog({
  open,
  runId,
  checkpointLabel,
  recordsProcessed,
  onCancel,
  onConfirm,
  loading,
}: RetryDialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [mode, setMode] = useState<'resume' | 'restart'>('resume');

  useEffect(() => {
    if (open) setMode('resume');
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="w-full max-w-lg rounded-2xl border border-white/20 bg-white/90 p-0 shadow-xl backdrop-blur-xl motion-safe:animate-[scale-in_180ms_ease-out] dark:border-white/10 dark:bg-slate-900/90 backdrop:bg-black/30 backdrop:backdrop-blur-sm"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClose={() => {
        if (open) onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
    >
      <div className="space-y-4 p-5">
        <div>
          <div className="text-h3 dark:text-slate-100">Reîncearcă ingestia eșuată</div>
          <p className="text-body text-muted dark:text-slate-400">
            Se va crea o nouă rulare. Alege modul de reîncercare de mai jos.
          </p>
        </div>

        <div className="rounded-lg border bg-muted/10 p-3 text-sm dark:border-slate-700/60 dark:bg-slate-800/50">
          <div className="text-caption text-muted dark:text-slate-400">ID rulare</div>
          <div className="font-mono text-xs dark:text-slate-200">{runId ?? '—'}</div>
          <div className="mt-2 text-caption text-muted dark:text-slate-400">Checkpoint</div>
          <div className="text-sm dark:text-slate-200">
            {checkpointLabel ?? 'Ultimul pas reușit'}
          </div>
          <div className="mt-2 text-caption text-muted dark:text-slate-400">
            Înregistrări procesate până la oprire
          </div>
          <div className="text-sm dark:text-slate-200">
            {typeof recordsProcessed === 'number' ? recordsProcessed.toLocaleString('ro-RO') : '—'}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-caption text-muted dark:text-slate-400">Mod de reîncercare</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('resume')}
              className={`rounded-xl border-2 p-4 text-left transition-all duration-200 ${
                mode === 'resume'
                  ? 'border-blue-500 bg-blue-50/80 ring-2 ring-blue-500/20 dark:border-blue-400 dark:bg-blue-900/30 dark:ring-blue-400/20'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
              }`}
            >
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Reia de la checkpoint
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Continuă de unde s-a oprit. Dacă Shopify încă procesează, reia polling-ul.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode('restart')}
              className={`rounded-xl border-2 p-4 text-left transition-all duration-200 ${
                mode === 'restart'
                  ? 'border-blue-500 bg-blue-50/80 ring-2 ring-blue-500/20 dark:border-blue-400 dark:bg-blue-900/30 dark:ring-blue-400/20'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
              }`}
            >
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Repornire completă
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Pornește o operație Shopify nouă de la zero.
              </div>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Anulează
          </Button>
          <span className="inline-flex items-center gap-1.5">
            <Button variant="secondary" onClick={() => onConfirm(mode)} loading={loading ?? false}>
              Reîncearcă
            </Button>
            <InfoTooltip title="Reîncearcă ingestia" side="bottom">
              Lansează o nouă rulare pe baza modului ales. „Reia" continuă de la ultimul checkpoint
              salvat, economisind timp. „Repornire completă" recreează totul de la zero. Datele
              existente nu sunt șterse.
            </InfoTooltip>
          </span>
        </div>
      </div>
    </dialog>
  );
}
