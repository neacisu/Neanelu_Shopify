export interface ProductSearchRequest {
  q: string;
  limit?: number;
  threshold?: number;
}

export interface ProductSearchResult {
  id: string;
  title: string;
  similarity: number;
  highlights?: string[];
}

export interface ProductSearchResponse {
  results: ProductSearchResult[];
  query: string;
  vectorSearchTimeMs: number;
  cached: boolean;
}
