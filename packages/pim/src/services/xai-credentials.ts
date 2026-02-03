export type XAICredentials = Readonly<{
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokensPerRequest: number;
  rateLimitPerMinute: number;
  dailyBudget: number;
  budgetAlertThreshold: number;
}>;
