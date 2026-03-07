import { COST_CONSTANTS, type ApiProvider } from './cost-tracker.js';

export type ChatApiProvider = Exclude<ApiProvider, 'serper'>;

export type ChatModelCredentials = Readonly<{
  provider: ChatApiProvider;
  apiKey?: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokensPerRequest: number;
  rateLimitPerMinute: number;
}>;

export function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, '');
  return `${normalized.endsWith('/v1') ? normalized : `${normalized}/v1`}/chat/completions`;
}

export function estimateChatCost(params: {
  provider: ChatApiProvider;
  tokensInput: number;
  tokensOutput: number;
}): number {
  if (params.provider === 'xai') {
    return (
      (params.tokensInput / 1_000_000) * COST_CONSTANTS.xai.costPer1MInput +
      (params.tokensOutput / 1_000_000) * COST_CONSTANTS.xai.costPer1MOutput
    );
  }

  const rate = COST_CONSTANTS[params.provider].costPer1MTokens;
  return ((params.tokensInput + params.tokensOutput) / 1_000_000) * rate;
}
