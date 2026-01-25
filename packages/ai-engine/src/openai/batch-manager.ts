import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export type OpenAiFile = Readonly<{
  id: string;
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
}>;

export type OpenAiBatchRequestCounts = Readonly<{
  total: number;
  completed: number;
  failed: number;
}>;

export type OpenAiBatch = Readonly<{
  id: string;
  status: string;
  endpoint: string;
  input_file_id: string;
  output_file_id: string | null;
  error_file_id: string | null;
  created_at: number;
  completed_at: number | null;
  expires_at: number | null;
  request_counts: OpenAiBatchRequestCounts | null;
}>;

export class OpenAiBatchManager {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  public constructor(params: { apiKey: string; baseUrl?: string; timeoutMs?: number }) {
    this.apiKey = params.apiKey;
    this.baseUrl = (params.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
    this.timeoutMs = Math.max(1_000, Math.trunc(params.timeoutMs ?? 30_000));
  }

  public isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  public async uploadJsonlFile(params: {
    filePath: string;
    purpose?: string;
  }): Promise<OpenAiFile> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY missing');

    const buffer = await readFile(params.filePath);
    const form = new FormData();
    const filename = basename(params.filePath);

    form.append('purpose', params.purpose ?? 'batch');
    form.append('file', new Blob([buffer]), filename);

    const json = await this.fetchJson(`${this.baseUrl}/v1/files`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
      },
      body: form,
    });

    return json as OpenAiFile;
  }

  public async createBatch(params: {
    inputFileId: string;
    endpoint?: string;
    completionWindow?: string;
    metadata?: Record<string, string>;
  }): Promise<OpenAiBatch> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY missing');

    const body = {
      input_file_id: params.inputFileId,
      endpoint: params.endpoint ?? '/v1/embeddings',
      completion_window: params.completionWindow ?? '24h',
      ...(params.metadata ? { metadata: params.metadata } : {}),
    };

    const json = await this.fetchJson(`${this.baseUrl}/v1/batches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    return json as OpenAiBatch;
  }

  public async getBatch(batchId: string): Promise<OpenAiBatch> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY missing');

    const json = await this.fetchJson(`${this.baseUrl}/v1/batches/${batchId}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
      },
    });

    return json as OpenAiBatch;
  }

  public async downloadFile(fileId: string): Promise<string> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY missing');

    const text = await this.fetchText(`${this.baseUrl}/v1/files/${fileId}/content`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
      },
    });

    return text;
  }

  public async deleteFile(fileId: string): Promise<void> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY missing');

    await this.fetchJson(`${this.baseUrl}/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
      },
    });
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `OPENAI_REQUEST_FAILED: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`
        );
      }
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  private async fetchText(url: string, init: RequestInit): Promise<string> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `OPENAI_REQUEST_FAILED: ${res.status} ${res.statusText}${body ? ` - ${body}` : ''}`
        );
      }
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  }
}
