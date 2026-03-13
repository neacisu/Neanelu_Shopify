import { createContext, useCallback, useContext, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { ActiveJob } from '../components/domain/ActiveJobsBanner.js';

export type JobsContextValue = Readonly<{
  jobs: readonly ActiveJob[];
  addJob: (job: ActiveJob) => void;
  updateJob: (id: string, update: Partial<ActiveJob>) => void;
  removeJob: (id: string) => void;
  dismissJob: (id: string) => void;
}>;

const JobsContext = createContext<JobsContextValue | null>(null);

export function JobsProvider({ children }: PropsWithChildren) {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);

  const addJob = useCallback((job: ActiveJob) => {
    setJobs((prev) => {
      const existing = prev.findIndex((j) => j.id === job.id);
      if (existing !== -1) {
        const next = [...prev];
        next[existing] = job;
        return next;
      }
      return [...prev, job];
    });
  }, []);

  const updateJob = useCallback((id: string, update: Partial<ActiveJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...update } : j)));
  }, []);

  const removeJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const dismissJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  return (
    <JobsContext.Provider value={{ jobs, addJob, updateJob, removeJob, dismissJob }}>
      {children}
    </JobsContext.Provider>
  );
}

export function useJobsContext(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobsContext must be used within JobsProvider');
  return ctx;
}

let _addJob: ((job: ActiveJob) => void) | null = null;
let _updateJob: ((id: string, update: Partial<ActiveJob>) => void) | null = null;
let _removeJob: ((id: string) => void) | null = null;

export function initJobsStore(
  addJob: (job: ActiveJob) => void,
  updateJob: (id: string, update: Partial<ActiveJob>) => void,
  removeJob: (id: string) => void
): void {
  _addJob = addJob;
  _updateJob = updateJob;
  _removeJob = removeJob;
}

export const jobsStore = {
  add: (job: ActiveJob) => _addJob?.(job),
  update: (id: string, update: Partial<ActiveJob>) => _updateJob?.(id, update),
  remove: (id: string) => _removeJob?.(id),
};
