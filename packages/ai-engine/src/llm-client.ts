import type { AiProvider, ChatCompletionParams, ChatCompletionResult } from '@app/types';

export interface LLMClient {
  readonly provider: AiProvider;
  isAvailable(): boolean;
  chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult>;
}

export class OpenAiCompatibleLLMClient implements LLMClient {
  public readonly provider: AiProvider;

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly defaultTemperature: number | undefined;
  private readonly defaultMaxTokens: number | undefined;
  private readonly defaultTimeoutMs: number;

  public constructor(params: {
    provider: AiProvider;
    apiKey?: string;
    baseUrl: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  }) {
    this.provider = params.provider;
    this.apiKey = params.apiKey?.trim();
    this.baseUrl = params.baseUrl.replace(/\/$/, '');
    this.defaultModel = params.model;
    this.defaultTemperature = params.temperature;
    this.defaultMaxTokens = params.maxTokens;
    this.defaultTimeoutMs = Math.max(1_000, Math.trunc(params.timeoutMs ?? 30_000));
  }

  public isAvailable(): boolean {
    return this.baseUrl.length > 0;
  }

  public async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? this.defaultTimeoutMs);
    const startedAt = Date.now();
    const endpointBase = this.baseUrl.endsWith('/v1') ? this.baseUrl : `${this.baseUrl}/v1`;

    try {
      const response = await fetch(`${endpointBase}/chat/completions`, {
        method: 'POST',
        headers: {
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model || this.defaultModel,
          messages: params.messages,
          ...(typeof (params.temperature ?? this.defaultTemperature) === 'number'
            ? { temperature: params.temperature ?? this.defaultTemperature }
            : {}),
          ...(typeof (params.maxTokens ?? this.defaultMaxTokens) === 'number'
            ? { max_tokens: params.maxTokens ?? this.defaultMaxTokens }
            : {}),
          ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? `LLM request failed with HTTP ${response.status}`
        );
      }

      return {
        content: payload.choices?.[0]?.message?.content ?? '',
        tokensInput: payload.usage?.prompt_tokens ?? 0,
        tokensOutput: payload.usage?.completion_tokens ?? 0,
        latencyMs,
        model: params.model || this.defaultModel,
        provider: this.provider,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
