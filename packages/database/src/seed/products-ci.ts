/**
 * Seed Script - CI-friendly deterministic dataset
 *
 * CONFORM: Plan_de_implementare.md F2.3.1 (db:seed:ci)
 * - Deterministic: faker.seed(12345)
 * - Smaller dataset for CI speed
 *
 * Usage:
 *   pnpm --filter @app/database run db:seed:ci
 */

import { faker } from '@faker-js/faker';
import { db, pool } from '../db.js';
import { shops } from '../schema/shops.js';
import { shopifyProducts } from '../schema/shopify-products.js';

faker.seed(12345);

const SHOP_DOMAIN = 'seed-ci.myshopify.com';
const PRODUCTS_COUNT = 1000;
const BATCH_SIZE = 500;

export async function seedProductsCi(): Promise<void> {
  console.info('🌱 Starting CI seed (deterministic)...');

  const [insertedShop] = await db
    .insert(shops)
    .values({
      shopifyDomain: SHOP_DOMAIN,
      shopifyShopId: 999000000,
      planTier: 'basic',
      accessTokenCiphertext: 'c2VlZF9jaV9jaXBoZXJ0ZXh0',
      accessTokenIv: 'c2VlZF9jaV9pdl9mYWtl',
      accessTokenTag: 'c2VlZF9jaV90YWdfZmFrZQ==',
      scopes: ['read_products'],
      settings: { seeded: true, ci: true },
    })
    .onConflictDoUpdate({
      target: shops.shopifyDomain,
      set: { updatedAt: new Date() },
    })
    .returning({ id: shops.id });

  const shopId = insertedShop?.id;
  if (!shopId) throw new Error('Failed to create CI seed shop');

  // Set tenant context for RLS
  await pool.query(`SELECT set_config('app.current_shop_id', $1, false)`, [shopId]);

  let batch: {
    shopId: string;
    shopifyGid: string;
    legacyResourceId: number;
    title: string;
    handle: string;
    status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
    metafields: Record<string, unknown>;
  }[] = [];

  for (let i = 0; i < PRODUCTS_COUNT; i++) {
    const title = faker.commerce.productName();
    const handle = `${faker.helpers.slugify(title)}-${i}`.toLowerCase();
    const status = i % 20 === 0 ? 'DRAFT' : 'ACTIVE';

    batch.push({
      shopId,
      shopifyGid: `gid://shopify/Product/${9000000 + i}`,
      legacyResourceId: 9000000 + i,
      title,
      handle,
      status,
      metafields: {
        custom: { weight: faker.number.float({ min: 0.1, max: 10, fractionDigits: 2 }) },
        tags: faker.helpers.arrayElements(['sale', 'new', 'featured'], { min: 0, max: 2 }),
      },
    });

    if (batch.length >= BATCH_SIZE || i === PRODUCTS_COUNT - 1) {
      await db.insert(shopifyProducts).values(batch).onConflictDoNothing();
      batch = [];
    }
  }

  await pool.query(`SELECT set_config('app.current_shop_id', '', false)`);
  console.info(`✅ CI seed complete: ${PRODUCTS_COUNT} products`);
}

void seedProductsCi().catch((err) => {
  console.error('❌ CI seed failed:', err);
  process.exit(1);
});
