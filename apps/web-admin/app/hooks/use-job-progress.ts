import { useCallback, useEffect, useRef, useState } from 'react';

export type JobStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled';

export type JobProgressStep = Readonly<{
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
}>;

export type JobProgressItem = Readonly<{
  id: string;
  label: string;
  status: 'running' | 'done' | 'error';
  message?: string;
}>;

export interface JobProgressState {
  status: JobStatus;
  progress: number;
  steps: JobProgressStep[];
  items: JobProgressItem[];
  elapsed: number;
  eta: number | null;
  counts: { processed: number; total: number; failed: number };
  cancel: () => void;
}

export type UseJobProgressOptions = Readonly<{
  jobId?: string;
  pollEndpoint?: string;
  pollInterval?: number;
  onComplete?: (result: unknown) => void;
  onError?: (error: unknown) => void;
}>;

interface PollResponse {
  status?: string;
  progress?: number;
  steps?: JobProgressStep[];
  items?: JobProgressItem[];
  counts?: { processed?: number; total?: number; failed?: number };
  result?: unknown;
  error?: string;
}

export function useJobProgress(options: UseJobProgressOptions): JobProgressState {
  const { jobId, pollEndpoint, pollInterval = 1500, onComplete, onError } = options;

  const [status, setStatus] = useState<JobStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [steps, setSteps] = useState<JobProgressStep[]>([]);
  const [items, setItems] = useState<JobProgressItem[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [eta, setEta] = useState<number | null>(null);
  const [counts, setCounts] = useState({ processed: 0, total: 0, failed: 0 });

  const cancelledRef = useRef(false);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setStatus('cancelled');
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
  }, []);

  useEffect(() => {
    if (!jobId || !pollEndpoint) return;

    cancelledRef.current = false;
    startTimeRef.current = Date.now();
    setStatus('queued');
    setProgress(0);
    setElapsed(0);

    elapsedIntervalRef.current = setInterval(() => {
      if (startTimeRef.current) {
        setElapsed(Date.now() - startTimeRef.current);
      }
    }, 1000);

    const poll = async () => {
      if (cancelledRef.current) return;

      try {
        const res = await fetch(`${pollEndpoint}/${jobId}/status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PollResponse;

        if (cancelledRef.current) return;

        const jobStatus = (data.status ?? 'running') as JobStatus;
        setStatus(jobStatus);
        setProgress(data.progress ?? 0);

        if (data.steps) setSteps(data.steps);
        if (data.items) setItems(data.items);

        if (data.counts) {
          const processed = data.counts.processed ?? 0;
          const total = data.counts.total ?? 0;
          const failed = data.counts.failed ?? 0;
          setCounts({ processed, total, failed });

          if (processed > 0 && total > 0 && startTimeRef.current) {
            const elapsedMs = Date.now() - startTimeRef.current;
            const rate = processed / elapsedMs;
            const remaining = total - processed;
            setEta(rate > 0 ? remaining / rate : null);
          }
        }

        if (jobStatus === 'completed') {
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
          onComplete?.(data.result);
        } else if (jobStatus === 'failed') {
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
          onError?.(new Error(data.error ?? 'Job failed'));
        }
      } catch (err) {
        if (!cancelledRef.current) {
          onError?.(err);
        }
      }
    };

    intervalRef.current = setInterval(() => {
      void poll();
    }, pollInterval);

    void poll();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    };
  }, [jobId, pollEndpoint, pollInterval, onComplete, onError]);

  return { status, progress, steps, items, elapsed, eta, counts, cancel };
}
