import { useState, useCallback } from 'react';
import { Activity, ChevronDown, ChevronUp, X } from 'lucide-react';

import { JobStatusBadge } from './JobProgressPanel.js';
import { Button } from '../ui/button.js';
import { ProgressBar } from '../ui/progress-bar.js';
import type { JobStatus } from '../../hooks/use-job-progress.js';

export type ActiveJob = Readonly<{
  id: string;
  label: string;
  status: JobStatus;
  progress?: number;
  counts?: { processed: number; total: number };
  startedAt?: number;
}>;

export type ActiveJobsBannerProps = Readonly<{
  jobs: readonly ActiveJob[];
  onDismiss?: (jobId: string) => void;
  className?: string;
}>;

function formatElapsed(startedAt: number): string {
  const ms = Date.now() - startedAt;
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

export function ActiveJobsBanner({ jobs, onDismiss, className = '' }: ActiveJobsBannerProps) {
  const [collapsed, setCollapsed] = useState(false);

  const activeJobs = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const recentlyDone = jobs.filter((j) => j.status === 'completed' || j.status === 'failed');

  if (activeJobs.length === 0 && recentlyDone.length === 0) return null;

  const totalJobs = activeJobs.length + recentlyDone.length;

  return (
    <div
      className={`sticky top-0 z-30 w-full motion-safe:animate-[fadeSlideUp_0.3s_ease-out_both] ${className}`}
      aria-live="polite"
      aria-label="Joburi active"
    >
      <div className="border-b border-border/60 bg-card shadow-(--shadow-sm) backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <button
            type="button"
            className="interactive flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-foreground"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-controls="active-jobs-list"
          >
            <Activity
              className={`size-4 text-primary ${activeJobs.length > 0 ? 'motion-safe:animate-[pulse-soft_2s_ease-in-out_infinite]' : ''}`}
            />
            <span>
              {activeJobs.length > 0
                ? `${activeJobs.length} job${activeJobs.length > 1 ? 'uri' : ''} activ${activeJobs.length > 1 ? 'e' : ''}`
                : `${recentlyDone.length} job${recentlyDone.length > 1 ? 'uri' : ''} finalizat${recentlyDone.length > 1 ? 'e' : ''}`}
            </span>
            {totalJobs > 1 ? (
              collapsed ? (
                <ChevronDown className="size-3.5 text-muted" />
              ) : (
                <ChevronUp className="size-3.5 text-muted" />
              )
            ) : null}
          </button>

          {!collapsed && totalJobs === 1 && jobs[0] ? (
            <SingleJobInline job={jobs[0]} {...(onDismiss ? { onDismiss } : {})} />
          ) : null}
        </div>

        {!collapsed && totalJobs > 1 ? (
          <div id="active-jobs-list" className="space-y-1.5 px-4 pb-3 pt-1">
            {activeJobs.map((job) => (
              <JobRow key={job.id} job={job} {...(onDismiss ? { onDismiss } : {})} />
            ))}
            {recentlyDone.map((job) => (
              <JobRow key={job.id} job={job} {...(onDismiss ? { onDismiss } : {})} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SingleJobInline({ job, onDismiss }: { job: ActiveJob; onDismiss?: (id: string) => void }) {
  const handleDismiss = useCallback(() => onDismiss?.(job.id), [job.id, onDismiss]);

  return (
    <div className="flex flex-1 items-center gap-3 overflow-hidden">
      {job.progress !== undefined ? (
        <JobStatusBadge status={job.status} progress={job.progress} animated />
      ) : (
        <JobStatusBadge status={job.status} animated />
      )}
      <span className="truncate text-sm text-muted">{job.label}</span>
      {job.progress !== undefined && (job.status === 'running' || job.status === 'queued') ? (
        <div className="w-24 shrink-0">
          <ProgressBar
            progress={job.progress}
            size="sm"
            variant={job.status === 'running' ? 'default' : 'default'}
          />
        </div>
      ) : null}
      {job.counts ? (
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {job.counts.processed}/{job.counts.total}
        </span>
      ) : null}
      {job.startedAt ? (
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {formatElapsed(job.startedAt)}
        </span>
      ) : null}
      {onDismiss && (job.status === 'completed' || job.status === 'failed') ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          aria-label={`Închide jobul: ${job.label}`}
          className="shrink-0 p-0.5"
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

function JobRow({ job, onDismiss }: { job: ActiveJob; onDismiss?: (id: string) => void }) {
  const handleDismiss = useCallback(() => onDismiss?.(job.id), [job.id, onDismiss]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-subtle/30 px-3 py-2 transition-colors duration-fast hover:border-border/60 hover:bg-subtle/50">
      {job.progress !== undefined ? (
        <JobStatusBadge status={job.status} progress={job.progress} animated />
      ) : (
        <JobStatusBadge status={job.status} animated />
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{job.label}</span>
      {job.progress !== undefined ? (
        <div className="w-20 shrink-0">
          <ProgressBar
            progress={job.progress}
            size="sm"
            variant={
              job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'default'
            }
          />
        </div>
      ) : null}
      {job.counts ? (
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {job.counts.processed}/{job.counts.total}
        </span>
      ) : null}
      {job.startedAt ? (
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {formatElapsed(job.startedAt)}
        </span>
      ) : null}
      {onDismiss && (job.status === 'completed' || job.status === 'failed') ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          aria-label={`Închide jobul: ${job.label}`}
          className="shrink-0 p-0.5"
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
