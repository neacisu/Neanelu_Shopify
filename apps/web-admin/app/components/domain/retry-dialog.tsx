import { useEffect, useState } from 'react';

import { PolarisModal } from '../../../components/polaris/index.js';
import { Button } from '../ui/button';

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
    <PolarisModal open={open} onClose={onCancel}>
      <div className="space-y-4 p-4">
        <div>
          <div className="text-h3">Retry failed ingestion</div>
          <p className="text-body text-muted">
            This will create a new run resuming from the last checkpoint when possible.
          </p>
        </div>

        <div className="rounded-md border bg-muted/10 p-3 text-sm">
          <div className="text-caption text-muted">Run ID</div>
          <div className="font-mono text-xs">{runId ?? '—'}</div>
          <div className="mt-2 text-caption text-muted">Checkpoint</div>
          <div className="text-sm">{checkpointLabel ?? 'Last successful step'}</div>
          <div className="mt-2 text-caption text-muted">Records processed</div>
          <div className="text-sm">
            {typeof recordsProcessed === 'number' ? recordsProcessed : '—'}
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="text-caption text-muted">Retry mode</div>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="retry-mode"
              value="resume"
              checked={mode === 'resume'}
              onChange={() => setMode('resume')}
            />
            Resume from checkpoint
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="retry-mode"
              value="restart"
              checked={mode === 'restart'}
              onChange={() => setMode('restart')}
            />
            Full restart
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => onConfirm(mode)} loading={loading ?? false}>
            Retry
          </Button>
        </div>
      </div>
    </PolarisModal>
  );
}
