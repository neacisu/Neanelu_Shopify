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

export type DashboardSummaryResponse = Readonly<{
  totalProducts: number;
  activeBulkRuns: number;
  apiErrorRate: number | null;
  apiLatencyP95Ms: number | null;
  goldenCount: number;
  goldenRate: number;
  avgQualityScore: number;
  todayWebhooks: number;
  queueBacklog: number;
  enrichmentSuccessRate: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  todayAiCost: number;
}>;

export type DashboardSummaryTrendPoint = Readonly<{
  date: string;
  totalProducts: number;
  goldenRate: number;
  avgQualityScore: number;
  queueBacklog: number;
  enrichmentSuccessRate: number;
  apiErrorRate: number;
  todayAiCost: number;
}>;

export type DashboardSummaryTrendResponse = Readonly<{
  days: number;
  points: readonly DashboardSummaryTrendPoint[];
}>;

export type DashboardHealthScoreResponse = Readonly<{
  score: number;
  components: Readonly<{
    redis: Readonly<{ ok: boolean; score: number }>;
    errorRate: Readonly<{ value: number; score: number }>;
    latency: Readonly<{ valueMs: number; score: number }>;
    backlog: Readonly<{ count: number; score: number }>;
  }>;
  status: 'healthy' | 'degraded' | 'critical';
}>;
