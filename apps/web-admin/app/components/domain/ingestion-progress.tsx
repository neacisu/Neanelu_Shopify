import { CheckCircle, Circle, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '../ui/button';
import { ConfirmDialog } from './confirm-dialog';
import { PolarisProgressBar } from '../../../components/polaris/index.js';

export type IngestionStepId = 'download' | 'parse' | 'transform' | 'save';

export interface IngestionProgressProps {
  currentStep: IngestionStepId;
  progress: number;
  status?: 'running' | 'failed' | 'completed';
  onAbort?: () => void;
  abortDisabled?: boolean;
}

const stepLabels: Record<IngestionStepId, string> = {
  download: 'Download',
  parse: 'Parse',
  transform: 'Transform',
  save: 'Save',
};

export function IngestionProgress({
  currentStep,
  progress,
  status = 'running',
  onAbort,
  abortDisabled,
}: IngestionProgressProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const steps = useMemo<IngestionStepId[]>(() => ['download', 'parse', 'transform', 'save'], []);

  const currentIndex = steps.indexOf(currentStep);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-h3">Ingestion in progress</div>
          <div className="text-caption text-muted">
            {status === 'failed'
              ? 'Last run failed. Review logs to continue.'
              : status === 'completed'
                ? 'Ingestion completed successfully.'
                : 'Processing data in the background.'}
          </div>
        </div>
        {onAbort ? (
          <Button
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
            disabled={abortDisabled}
            loading={abortDisabled ?? false}
          >
            Abort
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-4">
          {steps.map((step, index) => {
            const isCompleted = index < currentIndex;
            const isActive = index === currentIndex;

            return (
              <div key={step} className="flex items-center gap-2">
                {isCompleted ? (
                  <CheckCircle className="size-5 text-emerald-500" />
                ) : isActive ? (
                  <Loader2 className="size-5 animate-spin text-blue-400" />
                ) : (
                  <Circle className="size-5 text-gray-400" />
                )}
                <span
                  className={
                    isActive
                      ? 'text-sm font-medium text-foreground'
                      : isCompleted
                        ? 'text-sm text-foreground'
                        : 'text-sm text-muted'
                  }
                >
                  {stepLabels[step]}
                </span>
              </div>
            );
          })}
        </div>

        <div className="rounded-md border bg-muted/10 px-4 py-3">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Overall progress</span>
            <span>{Math.min(Math.max(progress, 0), 100)}%</span>
          </div>
          <div className="mt-2">
            <PolarisProgressBar progress={Math.min(Math.max(progress, 0), 100)} />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Abort ingestion?"
        message="This will cancel the current ingestion run. You can retry it later from history."
        confirmLabel="Abort"
        cancelLabel="Cancel"
        confirmTone="critical"
        confirmDisabled={abortDisabled ?? false}
        confirmLoading={abortDisabled ?? false}
        cancelDisabled={abortDisabled ?? false}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onAbort?.();
        }}
      />
    </div>
  );
}
