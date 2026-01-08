import type { ApiErrorResponse, ApiSuccessResponse } from '@app/types';

import { ApiError } from '../utils/api-error';
import { clearSessionTokenCache } from './session-auth';

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /**
   * Optional async hook to inject auth headers.
   *
   * Note: for now we rely on cookie auth (`credentials: 'include'`).
   * When Shopify App Bridge is enabled, this can return a session token header.
   */
  getAuthHeaders?: () => Promise<Record<string, string>>;
}

function isApiEnvelope(value: unknown): value is ApiSuccessResponse<unknown> | ApiErrorResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record['success'] === 'boolean' && typeof record['meta'] === 'object';
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  try {
    const text = await response.text();
    return text.length ? text : undefined;
  } catch {
    return undefined;
  }
}

function normalizeError(options: {
  status: number;
  body: unknown;
  fallbackMessage: string;
}): ApiError {
  const { status, body, fallbackMessage } = options;

  if (isApiEnvelope(body) && body.success === false) {
    const errorOptions: {
      status: number;
      retryable?: boolean;
      code?: string;
      details?: Record<string, unknown>;
    } = {
      status,
      code: body.error.code,
      retryable: status >= 500 || status === 429,
    };

    if (body.error.details && typeof body.error.details === 'object') {
      errorOptions.details = body.error.details;
    }

    return new ApiError(body.error.message || fallbackMessage, errorOptions);
  }

  if (typeof body === 'string' && body.trim().length > 0) {
    return new ApiError(body, { status, retryable: status >= 500 || status === 429 });
  }

  return new ApiError(fallbackMessage, { status, retryable: status >= 500 || status === 429 });
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? '/api';
  const fetchImpl = options.fetchImpl ?? fetch;
  const getAuthHeaders = options.getAuthHeaders;

  async function doFetch(url: string, init: RequestInit, authHeaders: Record<string, string>) {
    return fetchImpl(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...authHeaders,
      },
      // Cookie auth (fallback). Embedded: Authorization header is preferred.
      credentials: 'include',
    });
  }

  async function request(input: string, init: RequestInit = {}) {
    const url = input.startsWith('http')
      ? input
      : `${baseUrl}${input.startsWith('/') ? '' : '/'}${input}`;

    let authHeaders = getAuthHeaders ? await getAuthHeaders() : {};
    let response = await doFetch(url, init, authHeaders);

    // One-shot recovery: refresh session token and retry once.
    if (response.status === 401 && getAuthHeaders) {
      clearSessionTokenCache();
      authHeaders = await getAuthHeaders();
      response = await doFetch(url, init, authHeaders);
    }

    if (!response.ok) {
      const body = await readResponseBody(response);
      throw normalizeError({
        status: response.status,
        body,
        fallbackMessage: `Request failed (${response.status})`,
      });
    }

    return response;
  }

  async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await request(path, init);
    return (await readResponseBody(response)) as T;
  }

  async function getApi<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await request(path, init);
    const body = await readResponseBody(response);

    if (isApiEnvelope(body)) {
      if (body.success === true) return body.data as T;
      throw normalizeError({
        status: response.status,
        body,
        fallbackMessage: 'API request failed',
      });
    }

    throw new ApiError('Unexpected API response', { status: response.status, retryable: false });
  }

  async function postApi<TResponse, TBody extends Record<string, unknown> | FormData>(
    path: string,
    body: TBody,
    init: RequestInit = {}
  ): Promise<TResponse> {
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

    return getApi<TResponse>(path, {
      ...init,
      method: 'POST',
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(init.headers ?? {}),
      },
      body: isFormData ? body : JSON.stringify(body),
    });
  }

  return {
    request,
    getJson,
    getApi,
    postApi,
  };
}
