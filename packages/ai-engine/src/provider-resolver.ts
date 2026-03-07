import type { AiProvider } from '@app/types';
import { OpenAiCompatibleLLMClient, type LLMClient } from './llm-client.js';

export function createLLMClientForProvider(params: {
  provider: AiProvider;
  apiKey?: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): LLMClient {
  if (params.provider === 'gemini') {
    throw new Error('Gemini request adapter is not implemented in ai-engine');
  }

  return new OpenAiCompatibleLLMClient({
    provider: params.provider,
    baseUrl: params.baseUrl,
    model: params.model,
    ...(params.apiKey ? { apiKey: params.apiKey } : {}),
    ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
    ...(typeof params.maxTokens === 'number' ? { maxTokens: params.maxTokens } : {}),
    ...(typeof params.timeoutMs === 'number' ? { timeoutMs: params.timeoutMs } : {}),
  });
}
