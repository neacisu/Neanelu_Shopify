import { useEffect, useState } from 'react';

import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';
import { Modal } from '../ui/modal';

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
  const [mode, setMode] = useState<'resume' | 'restart'>('resume');

  useEffect(() => {
    if (open) setMode('resume');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Reîncearcă ingestia eșuată"
      className="sm:max-w-lg"
    >
      <div className="space-y-4 p-5">
        <div>
          <div className="text-h3">Reîncearcă ingestia eșuată</div>
          <p className="text-body text-muted">
            Se va crea o nouă rulare. Alege modul de reîncercare de mai jos.
          </p>
        </div>
        <div className="rounded-lg border bg-muted/10 p-3 text-sm">
          <div className="text-caption text-muted">ID rulare</div>
          <div className="font-mono text-xs">{runId ?? '—'}</div>
          <div className="mt-2 text-caption text-muted">Checkpoint</div>
          <div className="text-sm">{checkpointLabel ?? 'Ultimul pas reușit'}</div>
          <div className="mt-2 text-caption text-muted">Înregistrări procesate până la oprire</div>
          <div className="text-sm">
            {typeof recordsProcessed === 'number' ? recordsProcessed.toLocaleString('ro-RO') : '—'}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-caption text-muted">Mod de reîncercare</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant={mode === 'resume' ? 'secondary' : 'ghost'}
              onClick={() => setMode('resume')}
              className={`h-auto flex-col items-start rounded-xl border-2 p-4 text-left transition-all duration-200 ${
                mode === 'resume' ? 'border-primary ring-2 ring-primary/20' : 'border-border'
              }`}
            >
              <div className="text-sm font-semibold text-foreground">Reia de la checkpoint</div>
              <div className="mt-1 text-xs text-muted">
                Continuă de unde s-a oprit. Dacă Shopify încă procesează, reia polling-ul.
              </div>
            </Button>
            <Button
              type="button"
              variant={mode === 'restart' ? 'secondary' : 'ghost'}
              onClick={() => setMode('restart')}
              className={`h-auto flex-col items-start rounded-xl border-2 p-4 text-left transition-all duration-200 ${
                mode === 'restart' ? 'border-primary ring-2 ring-primary/20' : 'border-border'
              }`}
            >
              <div className="text-sm font-semibold text-foreground">Repornire completă</div>
              <div className="mt-1 text-xs text-muted">
                Pornește o operație Shopify nouă de la zero.
              </div>
            </Button>
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
    </Modal>
  );
}
