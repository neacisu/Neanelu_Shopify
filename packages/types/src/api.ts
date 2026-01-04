export interface ApiMeta {
  request_id: string;
  timestamp: string; // ISO8601
}

export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
  meta: ApiMeta;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorPayload;
  meta: ApiMeta;
}

export type PaginatedResponse<TItem> = ApiSuccessResponse<{
  items: TItem[];
  page: number;
  limit: number;
  total?: number;
}>;
