export interface ProductVariant {
  id: string;
  sku?: string | null;
  title?: string | null;
}

export interface Product {
  id: string;
  title: string;
  vendor?: string | null;
  status?: string | null;
  variants?: ProductVariant[];
}
