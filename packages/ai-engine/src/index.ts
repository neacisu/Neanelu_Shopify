import { createHash } from 'node:crypto';

export type EmbeddingModel = Readonly<{
  name: string;
  dimensions: number;
}>;

export interface EmbeddingsProvider {
  readonly kind: 'openai' | 'noop';
  readonly model: EmbeddingModel;
  isAvailable(): boolean;
  embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export class EmbeddingsDisabledError extends Error {
  public override readonly name = 'EmbeddingsDisabledError';
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function assertEmbeddingDimensions(embeddings: readonly (readonly number[])[], dims: number): void {
  for (const e of embeddings) {
    if (!Array.isArray(e) || e.length !== dims) {
      throw new Error(
        `VECTOR_DIMENSION_MISMATCH: expected ${dims}, got ${Array.isArray(e) ? e.length : 'non-array'}`
      );
    }
  }
}

class NoopEmbeddingsProvider implements EmbeddingsProvider {
  public readonly kind = 'noop' as const;
  public readonly model: EmbeddingModel;

  public constructor(model: EmbeddingModel) {
    this.model = model;
  }

  public isAvailable(): boolean {
    return false;
  }

  public embedTexts(_texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.reject(
      new EmbeddingsDisabledError('Embeddings provider is disabled / not configured')
    );
  }
}

class OpenAiEmbeddingsProvider implements EmbeddingsProvider {
  public readonly kind = 'openai' as const;
  public readonly model: EmbeddingModel;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  public constructor(params: {
    apiKey: string;
    baseUrl?: string;
    model: EmbeddingModel;
    timeoutMs?: number;
  }) {
    this.apiKey = params.apiKey;
    this.baseUrl = (params.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
    this.model = params.model;
    this.timeoutMs = Math.max(1_000, Math.trunc(params.timeoutMs ?? 30_000));
  }

  public isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  public async embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (!this.apiKey) throw new EmbeddingsDisabledError('OPENAI_API_KEY missing');

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model.name,
          input: texts,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `EMBEDDING_FAILED: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`
        );
      }

      const json = (await res.json()) as {
        data?: { embedding?: number[] }[];
      };

      const data = json.data ?? [];
      const embeddings = data.map((d) => d.embedding ?? []);
      assertEmbeddingDimensions(embeddings, this.model.dimensions);
      return embeddings;
    } finally {
      clearTimeout(t);
    }
  }
}

export function createEmbeddingsProvider(params: {
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiEmbeddingsModel?: string;
  openAiTimeoutMs?: number;
}): EmbeddingsProvider {
  const modelNameTrimmed = params.openAiEmbeddingsModel?.trim();
  const model: EmbeddingModel = {
    name:
      modelNameTrimmed && modelNameTrimmed.length > 0 ? modelNameTrimmed : 'text-embedding-3-small',
    dimensions: 1536,
  };

  const apiKey = params.openAiApiKey?.trim();
  if (!apiKey) return new NoopEmbeddingsProvider(model);

  return new OpenAiEmbeddingsProvider({
    apiKey,
    model,
    ...(params.openAiBaseUrl ? { baseUrl: params.openAiBaseUrl } : {}),
    ...(typeof params.openAiTimeoutMs === 'number' ? { timeoutMs: params.openAiTimeoutMs } : {}),
  });
}
