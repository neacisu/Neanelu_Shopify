import { CheckCircle, Circle, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';
import { ConfirmDialog } from './confirm-dialog';
import { ProgressBar } from '../ui/progress-bar';

export type IngestionStepId = 'download' | 'parse' | 'transform' | 'save';

export interface IngestionStageMetric {
  id: 'download' | 'parse' | 'ingest';
  label: string;
  progress?: number | null;
  processedLabel?: string | null;
  totalLabel?: string | null;
  speedLabel?: string | null;
  etaLabel?: string | null;
}

export interface IngestionProgressProps {
  currentStep: IngestionStepId;
  progress: number;
  status?: 'running' | 'failed' | 'completed';
  onAbort?: () => void;
  abortDisabled?: boolean;
  overallLabel?: string | null;
  overallProcessedLabel?: string | null;
  overallTotalLabel?: string | null;
  overallSpeedLabel?: string | null;
  overallEtaLabel?: string | null;
  stageDetails?: IngestionStageMetric[];
}

const stepLabels: Record<IngestionStepId, string> = {
  download: 'Descărcare',
  parse: 'Parsare',
  transform: 'Transformare',
  save: 'Salvare',
};

export function IngestionProgress({
  currentStep,
  progress,
  status = 'running',
  onAbort,
  abortDisabled,
  overallLabel,
  overallProcessedLabel,
  overallTotalLabel,
  overallSpeedLabel,
  overallEtaLabel,
  stageDetails,
}: IngestionProgressProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const steps = useMemo<IngestionStepId[]>(() => ['download', 'parse', 'transform', 'save'], []);

  const currentIndex = steps.indexOf(currentStep);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Ingestie în curs</h3>
          <p className="mt-0.5 text-sm text-muted">
            {status === 'failed'
              ? 'Ultima rulare a eșuat. Verifică log-urile pentru a continua.'
              : status === 'completed'
                ? 'Ingestia s-a finalizat cu succes.'
                : 'Datele se procesează în fundal.'}
          </p>
        </div>
        {onAbort ? (
          <span className="inline-flex items-center gap-1.5">
            <Button
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={abortDisabled}
              loading={abortDisabled ?? false}
              className="transition-all duration-200 hover:shadow-[var(--shadow-sm)]"
            >
              Oprește
            </Button>
            <InfoTooltip title="Oprește ingestia" side="bottom" maxWidth={340}>
              Anulează rularea curentă. Datele deja procesate rămân salvate; poți relansa mai târziu
              din istoric cu opțiunea „Reia de la checkpoint" pentru a continua de unde s-a oprit.
            </InfoTooltip>
          </span>
        ) : null}
      </div>

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-4">
          {steps.map((step, index) => {
            const isCompleted = index < currentIndex;
            const isActive = index === currentIndex;

            return (
              <div
                key={step}
                className={`flex items-center gap-2 ${
                  isActive
                    ? 'rounded-lg bg-primary/10 px-2 py-1 motion-safe:animate-[ingestionStepPulse_2s_ease-in-out_infinite]'
                    : ''
                }`}
              >
                {isCompleted ? (
                  <CheckCircle className="size-5 shrink-0 text-success" aria-hidden />
                ) : isActive ? (
                  <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden />
                ) : (
                  <Circle className="size-5 shrink-0 text-muted" aria-hidden />
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

        <div className="rounded-lg border border-border bg-card px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center justify-between text-sm text-foreground">
            <span>{overallLabel ?? 'Progres total'}</span>
            <span className="font-medium tabular-nums">
              {Math.min(Math.max(progress, 0), 100)}%
            </span>
          </div>
          <div className="mt-2">
            <ProgressBar progress={Math.min(Math.max(progress, 0), 100)} />
          </div>
          {overallProcessedLabel || overallTotalLabel || overallSpeedLabel || overallEtaLabel ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>
                {overallProcessedLabel ?? '—'}
                {overallTotalLabel ? ` / ${overallTotalLabel}` : ''}
              </span>
              {overallSpeedLabel ? <span>Viteză: {overallSpeedLabel}</span> : null}
              {overallEtaLabel ? <span>ETA: {overallEtaLabel}</span> : null}
            </div>
          ) : null}
        </div>

        {stageDetails && stageDetails.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-3">
            {stageDetails.map((stage) => {
              const normalizedProgress = Math.min(Math.max(stage.progress ?? 0, 0), 100);

              return (
                <div
                  key={stage.id}
                  className="rounded-lg border border-border bg-card p-3 backdrop-blur-sm"
                >
                  <div className="text-sm font-medium text-foreground">{stage.label}</div>
                  <div className="mt-2">
                    <ProgressBar progress={normalizedProgress} />
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted">
                    <div>
                      {stage.processedLabel ?? '—'}
                      {stage.totalLabel ? ` / ${stage.totalLabel}` : ''}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0">
                      <span>Viteză: {stage.speedLabel ?? '—'}</span>
                      <span>ETA: {stage.etaLabel ?? '—'}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Oprești ingestia?"
        message="Rularea curentă va fi anulată. Poți reîncerca mai târziu din istoric."
        confirmLabel="Oprește"
        cancelLabel="Anulare"
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
