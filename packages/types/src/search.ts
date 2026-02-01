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
  featuredImageUrl?: string | null;
  vendor?: string | null;
  productType?: string | null;
  priceRange?: {
    min: string;
    max: string;
    currency: string;
  } | null;
}

export interface ProductSearchResponse {
  results: ProductSearchResult[];
  query: string;
  vectorSearchTimeMs: number;
  cached: boolean;
}

export interface CategoryNode {
  id: string;
  name: string;
  children?: CategoryNode[];
}

export interface ProductFiltersResponse {
  vendors: string[];
  productTypes: string[];
  priceRange: { min: number | null; max: number | null };
  categories: CategoryNode[];
}
