export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';

export interface Job {
  id: string;
  name: string;
  status: JobStatus;
  attemptsMade?: number;
  attempts?: number;
  progress?: number;
  timestamp?: string;
}
