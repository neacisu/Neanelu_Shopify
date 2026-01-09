export type DashboardJobType = 'sync' | 'webhook' | 'bulk' | 'ai-batch';

export type DashboardActivityPoint = Readonly<{
  /** Date in YYYY-MM-DD (UTC) */
  date: string;
  /** ISO timestamp representing the day bucket (UTC midnight). */
  timestamp: string;
  total: number;
  breakdown: Readonly<{
    sync: number;
    webhook: number;
    bulk: number;
    aiBatch: number;
  }>;
}>;

export type DashboardActivityResponse = Readonly<{
  days: number;
  points: readonly DashboardActivityPoint[];
}>;

export type DashboardAlertSeverity = 'warning' | 'critical';

export type DashboardAlert = Readonly<{
  /** Stable identifier (used for dismiss in sessionStorage) */
  id: string;
  severity: DashboardAlertSeverity;
  title: string;
  description: string;
  details?: Record<string, unknown>;
}>;

export type DashboardAlertsResponse = Readonly<{
  alerts: readonly DashboardAlert[];
}>;

export type DashboardStartSyncResponse = Readonly<{
  enqueued: boolean;
  jobId: string;
  queue: string;
}>;

export type DashboardClearCacheResponse = Readonly<{
  deletedKeys: number;
  truncated: boolean;
}>;
