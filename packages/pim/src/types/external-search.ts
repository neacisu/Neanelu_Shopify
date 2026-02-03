export type ExternalProductSearchResult = Readonly<{
  title: string;
  url: string;
  snippet?: string;
  position: number;
  source: 'organic' | 'shopping' | 'knowledge_graph';
  structuredData?: {
    gtin?: string;
    brand?: string;
    price?: string;
    currency?: string;
    rating?: number;
    availability?: string;
  };
}>;

export type SerperSearchOptions = Readonly<{
  query: string;
  searchType?: 'search' | 'shopping' | 'images';
  num?: number;
  gl?: string;
  hl?: string;
}>;
