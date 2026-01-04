export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}

export interface QueuesResponse {
  queues: QueueStats[];
}
