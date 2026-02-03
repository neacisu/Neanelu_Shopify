export interface ExternalProductSearchResult {
  title: string;
  url: string;
  snippet?: string;
  position: number;
  source: 'organic' | 'shopping' | 'knowledge_graph';
  structuredData?: {
    gtin?: string;
    brand?: string;
    price?: string;
    currency?: string;
    rating?: number;
    availability?: string;
  };
}

export interface SerperSettingsResponse {
  enabled: boolean;
  hasApiKey: boolean;
  dailyBudget: number;
  rateLimitPerSecond: number;
  cacheTtlSeconds: number;
  budgetAlertThreshold: number;
  todayUsage?: {
    requests: number;
    cost: number;
    percentUsed: number;
  };
}

export interface SerperSettingsUpdateRequest {
  enabled?: boolean;
  apiKey?: string;
  dailyBudget?: number;
  rateLimitPerSecond?: number;
  cacheTtlSeconds?: number;
  budgetAlertThreshold?: number;
}

export interface SerperHealthResponse {
  status: 'ok' | 'error' | 'disabled' | 'missing_key';
  message?: string;
  creditsRemaining?: number;
  responseTimeMs?: number;
}
