/**
 * Module B: Shopify Mirror - shopify_products & shopify_variants tables
 *
 * CONFORM: Database_Schema_Complete.md v2.6
 *
 * Aceste tabele mirror-uiesc datele din Shopify pentru:
 * - Query-uri locale rapide
 * - Indexare și căutare full-text
 * - Caching offline
 *
 * Ambele tabele au RLS cu shop_id isolation.
 */

import {
  pgTable,
  uuid,
  text,
  varchar,
  bigint,
  integer,
  boolean,
  timestamp,
  jsonb,
  decimal,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { shops } from './shops.ts';

// ============================================
// Table: shopify_products
// ============================================
export const shopifyProducts = pgTable(
  'shopify_products',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    // Shopify identifiers
    shopifyGid: varchar('shopify_gid', { length: 100 }).notNull(),
    legacyResourceId: bigint('legacy_resource_id', { mode: 'number' }).notNull(),

    // Product details
    title: text('title').notNull(),
    handle: varchar('handle', { length: 255 }).notNull(),
    description: text('description'),
    descriptionHtml: text('description_html'),
    vendor: varchar('vendor', { length: 255 }),
    productType: varchar('product_type', { length: 255 }),

    // Status - ACTIVE/DRAFT/ARCHIVED
    status: varchar('status', { length: 20 }).notNull(),

    // Tags array
    tags: text('tags')
      .array()
      .default(sql`'{}'::text[]`),

    // Product flags
    isGiftCard: boolean('is_gift_card').default(false),
    hasOnlyDefaultVariant: boolean('has_only_default_variant').default(true),
    hasOutOfStockVariants: boolean('has_out_of_stock_variants').default(false),
    requiresSellingPlan: boolean('requires_selling_plan').default(false),

    // Structured data
    options: jsonb('options').default([]),
    seo: jsonb('seo'),
    priceRange: jsonb('price_range'),
    compareAtPriceRange: jsonb('compare_at_price_range'),

    // Media
    featuredImageUrl: text('featured_image_url'),

    // Template
    templateSuffix: varchar('template_suffix', { length: 100 }),

    // Taxonomy
    categoryId: varchar('category_id', { length: 100 }),

    // Metafields cache
    metafields: jsonb('metafields').default({}),

    // Timestamps
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAtShopify: timestamp('created_at_shopify', { withTimezone: true }),
    updatedAtShopify: timestamp('updated_at_shopify', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_products_shop_gid').on(table.shopId, table.shopifyGid),
    index('idx_products_shop_handle').on(table.shopId, table.handle),
    index('idx_products_shop_status').on(table.shopId, table.status),
    index('idx_products_shop_vendor').on(table.shopId, table.vendor),
    // GIN indexes pentru arrays și JSONB se creează în migrația SQL
  ]
);

export type ShopifyProduct = typeof shopifyProducts.$inferSelect;
export type NewShopifyProduct = typeof shopifyProducts.$inferInsert;

// ============================================
// Table: shopify_variants
// ============================================
export const shopifyVariants = pgTable(
  'shopify_variants',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    productId: uuid('product_id')
      .notNull()
      .references(() => shopifyProducts.id, { onDelete: 'cascade' }),

    // Shopify identifiers
    shopifyGid: varchar('shopify_gid', { length: 100 }).notNull(),
    legacyResourceId: bigint('legacy_resource_id', { mode: 'number' }).notNull(),

    // Variant details
    title: varchar('title', { length: 255 }).notNull(),
    sku: varchar('sku', { length: 255 }), // Nullable per Shopify API
    barcode: varchar('barcode', { length: 100 }), // Nullable per Shopify API

    // Pricing
    price: decimal('price', { precision: 12, scale: 2 }).notNull(),
    compareAtPrice: decimal('compare_at_price', { precision: 12, scale: 2 }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).default('RON'),
    cost: decimal('cost', { precision: 12, scale: 2 }),

    // Weight
    weight: decimal('weight', { precision: 10, scale: 4 }),
    weightUnit: varchar('weight_unit', { length: 20 }).default('KILOGRAMS'),

    // Inventory
    inventoryQuantity: integer('inventory_quantity').default(0),
    inventoryPolicy: varchar('inventory_policy', { length: 20 }).default('DENY'),
    inventoryItemId: varchar('inventory_item_id', { length: 100 }),

    // Tax
    taxable: boolean('taxable').default(true),
    taxCode: varchar('tax_code', { length: 50 }),

    // Availability
    availableForSale: boolean('available_for_sale').default(true),
    requiresShipping: boolean('requires_shipping').default(true),
    requiresComponents: boolean('requires_components').default(false),

    // Position and options
    position: integer('position').default(1),
    selectedOptions: jsonb('selected_options').default([]),

    // Media
    imageUrl: text('image_url'),

    // Metafields
    metafields: jsonb('metafields').default({}),

    // Timestamps
    createdAtShopify: timestamp('created_at_shopify', { withTimezone: true }),
    updatedAtShopify: timestamp('updated_at_shopify', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_variants_shop_gid').on(table.shopId, table.shopifyGid),
    index('idx_variants_product').on(table.productId),
    index('idx_variants_shop_sku').on(table.shopId, table.sku),
    index('idx_variants_shop_barcode').on(table.shopId, table.barcode),
    index('idx_variants_inventory').on(table.shopId, table.inventoryQuantity),
  ]
);

export type ShopifyVariant = typeof shopifyVariants.$inferSelect;
export type NewShopifyVariant = typeof shopifyVariants.$inferInsert;
