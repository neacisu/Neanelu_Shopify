/**
 * Module B: Shopify Mirror - shopify_collections and related tables
 *
 * These tables already exist in SQL migrations and runtime code. This file aligns
 * the Drizzle schema with the live database so new modules can reference them safely.
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
  index,
  uniqueIndex,
  primaryKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { shops } from './shops.ts';
import { shopifyProducts } from './shopify-products.ts';
import { prodTaxonomy } from './pim.ts';

export const shopifyCollections = pgTable(
  'shopify_collections',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    shopifyGid: varchar('shopify_gid', { length: 100 }).notNull(),
    legacyResourceId: bigint('legacy_resource_id', { mode: 'number' }).notNull(),

    title: text('title').notNull(),
    titleEn: text('title_en'),
    handle: varchar('handle', { length: 255 }).notNull(),
    description: text('description'),
    descriptionHtml: text('description_html'),
    descriptionEn: text('description_en'),

    collectionType: varchar('collection_type', { length: 20 }).notNull(),
    sortOrder: varchar('sort_order', { length: 50 }),
    rules: jsonb('rules'),
    disjunctive: boolean('disjunctive').default(false),
    seo: jsonb('seo'),
    imageUrl: text('image_url'),
    pendingImagePath: text('pending_image_path'),
    productsCount: integer('products_count').default(0),
    templateSuffix: varchar('template_suffix', { length: 100 }),
    metafields: jsonb('metafields').default({}),

    parentCollectionId: uuid('parent_collection_id').references(
      (): AnyPgColumn => shopifyCollections.id,
      { onDelete: 'set null' }
    ),
    menuLevel: integer('menu_level'),
    menuPath: text('menu_path'),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_collections_shop_gid').on(table.shopId, table.shopifyGid),
    index('idx_collections_shop_handle').on(table.shopId, table.handle),
    index('idx_collections_type').on(table.shopId, table.collectionType),
    index('idx_collections_parent').on(table.parentCollectionId),
    index('idx_collections_menu_level').on(table.shopId, table.menuLevel),
  ]
);

export type ShopifyCollection = typeof shopifyCollections.$inferSelect;
export type NewShopifyCollection = typeof shopifyCollections.$inferInsert;

export const shopifyCollectionProducts = pgTable(
  'shopify_collection_products',
  {
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    collectionId: uuid('collection_id')
      .notNull()
      .references(() => shopifyCollections.id, { onDelete: 'cascade' }),

    productId: uuid('product_id')
      .notNull()
      .references(() => shopifyProducts.id, { onDelete: 'cascade' }),

    position: integer('position').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.collectionId, table.productId],
      name: 'shopify_collection_products_pk',
    }),
    index('idx_collection_products_shop').on(table.shopId),
    index('idx_collection_products_product').on(table.productId),
  ]
);

export type ShopifyCollectionProduct = typeof shopifyCollectionProducts.$inferSelect;
export type NewShopifyCollectionProduct = typeof shopifyCollectionProducts.$inferInsert;

export const pimTaxonomyCollectionMap = pgTable(
  'pim_taxonomy_collection_map',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    taxonomyId: uuid('taxonomy_id')
      .notNull()
      .references(() => prodTaxonomy.id, { onDelete: 'cascade' }),

    collectionId: uuid('collection_id')
      .notNull()
      .references(() => shopifyCollections.id, { onDelete: 'cascade' }),

    isPrimary: boolean('is_primary').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_pim_taxonomy_collection_map_unique').on(
      table.shopId,
      table.taxonomyId,
      table.collectionId
    ),
    index('idx_taxonomy_collection_map_shop_tax').on(table.shopId, table.taxonomyId),
  ]
);

export type PimTaxonomyCollectionMap = typeof pimTaxonomyCollectionMap.$inferSelect;
export type NewPimTaxonomyCollectionMap = typeof pimTaxonomyCollectionMap.$inferInsert;

export const pimTaxonomyMetafieldSchema = pgTable(
  'pim_taxonomy_metafield_schema',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    taxonomyId: uuid('taxonomy_id')
      .notNull()
      .references(() => prodTaxonomy.id, { onDelete: 'cascade' }),

    attrCode: varchar('attr_code', { length: 100 }).notNull(),
    shopifyNamespace: varchar('shopify_namespace', { length: 100 }).notNull(),
    shopifyKey: varchar('shopify_key', { length: 100 }).notNull(),
    shopifyType: varchar('shopify_type', { length: 50 }).notNull(),
    isRequired: boolean('is_required').default(false),
    displayName: varchar('display_name', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_pim_taxonomy_metafield_schema_unique').on(table.taxonomyId, table.attrCode),
    index('idx_taxonomy_metafield_schema_taxonomy').on(table.taxonomyId),
  ]
);

export type PimTaxonomyMetafieldSchema = typeof pimTaxonomyMetafieldSchema.$inferSelect;
export type NewPimTaxonomyMetafieldSchema = typeof pimTaxonomyMetafieldSchema.$inferInsert;
