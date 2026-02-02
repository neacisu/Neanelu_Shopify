export interface ProductVariant {
  id: string;
  sku?: string | null;
  title?: string | null;
}

export interface ProductVariantDetail extends ProductVariant {
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number;
  imageUrl: string | null;
  selectedOptions: { name: string; value: string }[];
}

export interface Product {
  id: string;
  title: string;
  vendor?: string | null;
  status?: string | null;
  variants?: ProductVariant[];
}

export type SyncStatus = 'synced' | 'pending' | 'error' | 'never';
export type QualityLevel = 'bronze' | 'silver' | 'golden' | 'review_needed';

export interface ProductPimData {
  masterId: string;
  taxonomyId: string | null;
  qualityLevel: QualityLevel;
  qualityScore: number | null;
  qualityScoreBreakdown: {
    completeness: number;
    accuracy: number;
    consistency: number;
  } | null;
  titleMaster: string | null;
  descriptionMaster: string | null;
  descriptionShort: string | null;
  brand: string | null;
  manufacturer: string | null;
  gtin: string | null;
  mpn: string | null;
  needsReview: boolean;
  promotedToSilverAt: string | null;
  promotedToGoldenAt: string | null;
}

export interface ProductDetail extends Product {
  handle: string;
  description: string | null;
  descriptionHtml: string | null;
  productType: string | null;
  tags: string[];
  featuredImageUrl: string | null;
  priceRange: { min: string; max: string; currency: string } | null;
  metafields: Record<string, unknown>;
  categoryId: string | null;
  syncedAt: string | null;
  createdAtShopify: string | null;
  updatedAtShopify: string | null;
  pim?: ProductPimData | null;
  variants: ProductVariantDetail[];
}

export interface ProductListItem {
  id: string;
  title: string;
  vendor: string | null;
  status: string | null;
  productType: string | null;
  featuredImageUrl: string | null;
  categoryId: string | null;
  syncedAt: string | null;
  updatedAtShopify: string | null;
  variantsCount: number;
  syncStatus: SyncStatus | null;
  qualityLevel: QualityLevel | null;
  qualityScore: number | null;
}
