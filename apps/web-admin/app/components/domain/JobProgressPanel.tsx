import { CheckCircle2, Clock, Loader2, XCircle, AlertTriangle, X, Pause } from 'lucide-react';
import type { JobStatus, JobProgressStep, JobProgressItem } from '../../hooks/use-job-progress';
import { ProgressBar } from '../ui/progress-bar';
import { Button } from '../ui/button';

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

export type JobStatusBadgeProps = Readonly<{
  status: JobStatus;
  progress?: number;
  count?: { done: number; total: number };
  animated?: boolean;
  className?: string;
}>;

export function JobStatusBadge({
  status,
  progress,
  count,
  animated = true,
  className = '',
}: JobStatusBadgeProps) {
  const configs: Record<JobStatus, { label: string; icon: React.ReactNode; classes: string }> = {
    idle: {
      label: 'Inactiv',
      icon: <Clock className="size-3" />,
      classes: 'bg-muted/10 text-muted ring-border/60',
    },
    queued: {
      label: 'În coadă',
      icon: (
        <Clock
          className={`size-3 ${animated ? 'motion-safe:animate-[status-dot-pulse_1.5s_ease-in-out_infinite]' : ''}`}
        />
      ),
      classes: 'bg-info/10 text-info ring-info/20',
    },
    running: {
      label: progress !== undefined ? `${progress.toFixed(0)}%` : 'Se rulează',
      icon: <Loader2 className={`size-3 ${animated ? 'animate-spin' : ''}`} />,
      classes: 'bg-primary/10 text-primary ring-primary/20',
    },
    completed: {
      label: count ? `${count.done}/${count.total}` : 'Finalizat',
      icon: <CheckCircle2 className="size-3" />,
      classes: 'bg-success/10 text-success ring-success/20',
    },
    failed: {
      label: 'Eșuat',
      icon: (
        <AlertTriangle
          className={`size-3 ${animated ? 'motion-safe:animate-[shake_0.4s_ease-out]' : ''}`}
        />
      ),
      classes: 'bg-error/10 text-error ring-error/20',
    },
    paused: {
      label: 'Pauzat',
      icon: <Pause className="size-3" />,
      classes: 'bg-warning/10 text-warning ring-warning/20',
    },
    cancelled: {
      label: 'Anulat',
      icon: <XCircle className="size-3" />,
      classes: 'bg-muted/10 text-muted ring-border/60',
    },
  };

  const cfg = configs[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cfg.classes} ${className}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

export type JobProgressPanelProps = Readonly<{
  title: string;
  status: JobStatus;
  progress?: number;
  steps?: readonly JobProgressStep[];
  items?: readonly JobProgressItem[];
  elapsed?: number;
  eta?: number | null;
  counts?: { processed: number; total: number; failed?: number };
  variant?: 'full' | 'compact' | 'inline';
  onCancel?: () => void;
  onClose?: () => void;
  className?: string;
}>;

function StepIndicator({ step }: { step: JobProgressStep }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 shrink-0">
        {step.status === 'done' ? (
          <CheckCircle2 className="size-4 text-success" aria-hidden />
        ) : step.status === 'active' ? (
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
        ) : step.status === 'error' ? (
          <XCircle className="size-4 text-error" aria-hidden />
        ) : (
          <div className="size-4 rounded-full border-2 border-border/60" aria-hidden />
        )}
      </div>
      <div className="min-w-0">
        <div
          className={`text-sm font-medium ${
            step.status === 'done'
              ? 'text-success'
              : step.status === 'active'
                ? 'text-foreground'
                : step.status === 'error'
                  ? 'text-error'
                  : 'text-muted'
          }`}
        >
          {step.label}
        </div>
        {step.detail ? <div className="mt-0.5 text-xs text-muted">{step.detail}</div> : null}
      </div>
    </div>
  );
}

function ProgressVariant({
  status,
}: {
  status: JobStatus;
}): 'default' | 'success' | 'error' | 'warning' {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'paused') return 'warning';
  return 'default';
}

export function JobProgressPanel({
  title,
  status,
  progress = 0,
  steps = [],
  items = [],
  elapsed,
  eta,
  counts,
  variant = 'compact',
  onCancel,
  onClose,
  className = '',
}: JobProgressPanelProps) {
  if (variant === 'inline') {
    return (
      <div className={`flex items-center gap-2 text-sm ${className}`} aria-live="polite">
        <JobStatusBadge
          status={status}
          progress={progress}
          {...(counts ? { count: { done: counts.processed, total: counts.total } } : {})}
        />
        {counts ? (
          <span className="text-muted tabular-nums">
            {counts.processed}/{counts.total}
          </span>
        ) : null}
        {elapsed ? <span className="text-muted tabular-nums">{formatMs(elapsed)}</span> : null}
      </div>
    );
  }

  const progressVariant = ProgressVariant({ status });
  const isIndeterminate = status === 'running' && progress === 0;

  return (
    <div
      className={`rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] backdrop-blur-sm ${className}`}
      aria-live="polite"
      aria-busy={status === 'running' || status === 'queued'}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{title}</span>
            <JobStatusBadge status={status} progress={progress} />
          </div>
          {counts ? (
            <div className="mt-0.5 text-xs text-muted tabular-nums">
              {counts.processed}/{counts.total} procesate
              {counts.failed ? ` · ${counts.failed} eșuate` : ''}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {elapsed ? (
            <span className="text-xs text-muted tabular-nums">{formatMs(elapsed)}</span>
          ) : null}
          {eta ? (
            <span className="text-xs text-muted tabular-nums">ETA: {formatMs(eta)}</span>
          ) : null}
          {onCancel && (status === 'running' || status === 'queued') ? (
            <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Anulează procesul">
              Anulează
            </Button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="interactive rounded-md p-1 text-muted hover:bg-subtle/50 hover:text-foreground"
              aria-label="Închide panoul de progres"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        <ProgressBar
          progress={progress}
          variant={progressVariant}
          indeterminate={isIndeterminate}
          size="sm"
        />
      </div>

      {variant === 'full' && steps.length > 0 ? (
        <div className="mt-4 space-y-2.5">
          {steps.map((step, i) => (
            <StepIndicator key={i} step={step} />
          ))}
        </div>
      ) : null}

      {variant === 'full' && items.length > 0 ? (
        <div className="mt-4 max-h-48 overflow-y-auto space-y-1.5">
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs">
              {item.status === 'done' ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              ) : item.status === 'error' ? (
                <XCircle className="mt-0.5 size-3.5 shrink-0 text-error" aria-hidden />
              ) : (
                <Loader2
                  className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary"
                  aria-hidden
                />
              )}
              <span className="min-w-0 text-foreground">{item.label}</span>
              {item.message ? <span className="shrink-0 text-muted">{item.message}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
