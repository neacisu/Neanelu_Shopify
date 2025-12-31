/**
 * Seed Script - 10K Products Deterministic
 *
 * CONFORM: Plan_de_implementare.md F2.3.1
 * PR-012: Seed script pentru date sintetice
 *
 * Specificații:
 * - 5 shops × 2,000 produse = 10,000 produse
 * - ~20,000 variante (1-3 per produs)
 * - Deterministic: faker.seed(12345)
 * - Timp țintă: <30s
 *
 * Usage:
 *   pnpm --filter @app/database run db:seed
 */

import { faker } from '@faker-js/faker';
import { db, pool } from '../db.js';
import { shops, type NewShop } from '../schema/shops.js';
import { shopifyProducts, type NewShopifyProduct } from '../schema/shopify-products.js';
import { shopifyVariants, type NewShopifyVariant } from '../schema/shopify-products.js';

// DETERMINISTIC SEED
faker.seed(12345);

const SHOPS_COUNT = 5;
const PRODUCTS_PER_SHOP = 2000;
const BATCH_SIZE = 500;

// ============================================
// Test Shops Configuration
// ============================================
const SHOP_CONFIGS = [
  { domain: 'seed-shop-1.myshopify.com', plan: 'basic' as const },
  { domain: 'seed-shop-2.myshopify.com', plan: 'pro' as const },
  { domain: 'seed-shop-3.myshopify.com', plan: 'enterprise' as const },
  { domain: 'seed-shop-4.myshopify.com', plan: 'basic' as const },
  { domain: 'seed-shop-5.myshopify.com', plan: 'pro' as const },
];

// Fake encrypted token (just for seed - not real encryption)
const FAKE_TOKEN = {
  ciphertext: 'c2VlZF90b2tlbl9jaXBoZXJ0ZXh0X2Zha2U=',
  iv: 'c2VlZF9pdl9mYWtl',
  tag: 'c2VlZF90YWdfZmFrZQ==',
};

// ============================================
// Generators
// ============================================

function generateShop(config: (typeof SHOP_CONFIGS)[0], index: number): NewShop {
  return {
    shopifyDomain: config.domain,
    shopifyShopId: 1000000000 + index,
    planTier: config.plan,
    accessTokenCiphertext: FAKE_TOKEN.ciphertext,
    accessTokenIv: FAKE_TOKEN.iv,
    accessTokenTag: FAKE_TOKEN.tag,
    scopes: ['read_products', 'write_products', 'read_inventory'],
    timezone: 'Europe/Bucharest',
    currencyCode: 'RON',
    settings: { seeded: true },
  };
}

function generateProduct(
  shopId: string,
  shopIndex: number,
  productIndex: number
): NewShopifyProduct {
  const title = faker.commerce.productName();
  const handle = `${faker.helpers.slugify(title)}-${productIndex}`.toLowerCase();

  // Deterministic status distribution: 90% ACTIVE, 5% DRAFT, 5% ARCHIVED
  const statusRoll = (shopIndex * PRODUCTS_PER_SHOP + productIndex) % 100;
  const status = statusRoll < 90 ? 'ACTIVE' : statusRoll < 95 ? 'DRAFT' : 'ARCHIVED';

  return {
    shopId,
    shopifyGid: `gid://shopify/Product/${1000000 + shopIndex * PRODUCTS_PER_SHOP + productIndex}`,
    legacyResourceId: 1000000 + shopIndex * PRODUCTS_PER_SHOP + productIndex,
    title,
    handle,
    description: faker.commerce.productDescription(),
    descriptionHtml: `<p>${faker.commerce.productDescription()}</p>`,
    vendor: faker.company.name(),
    productType: faker.commerce.department(),
    status,
    tags: faker.helpers.arrayElements(['sale', 'new', 'featured', 'clearance', 'bestseller'], {
      min: 0,
      max: 3,
    }),
    options: [
      { name: 'Size', values: ['S', 'M', 'L', 'XL'] },
      { name: 'Color', values: [faker.color.human(), faker.color.human()] },
    ],
    metafields: {
      custom: {
        weight: faker.number.float({ min: 0.1, max: 10, fractionDigits: 2 }),
        material: faker.commerce.productMaterial(),
        origin: faker.helpers.arrayElement(['Romania', 'EU', 'China', 'Turkey', 'USA']),
      },
      tags: faker.helpers.arrayElements(['sale', 'new', 'featured'], { min: 0, max: 2 }),
    },
    priceRange: {
      minVariantPrice: { amount: faker.commerce.price({ min: 10, max: 100 }), currencyCode: 'RON' },
      maxVariantPrice: {
        amount: faker.commerce.price({ min: 100, max: 500 }),
        currencyCode: 'RON',
      },
    },
    publishedAt: faker.date.past({ years: 1 }),
    createdAtShopify: faker.date.past({ years: 2 }),
    updatedAtShopify: faker.date.recent({ days: 30 }),
  };
}

function generateVariant(
  shopId: string,
  productId: string,
  shopIndex: number,
  productIndex: number,
  variantIndex: number
): NewShopifyVariant {
  const sizes = ['S', 'M', 'L', 'XL'] as const;
  const size = sizes[variantIndex % sizes.length] ?? 'M';

  return {
    shopId,
    productId,
    shopifyGid: `gid://shopify/ProductVariant/${2000000 + shopIndex * 100000 + productIndex * 10 + variantIndex}`,
    legacyResourceId: 2000000 + shopIndex * 100000 + productIndex * 10 + variantIndex,
    title: size,
    sku: `SKU-${shopIndex + 1}-${productIndex}-${variantIndex}`,
    barcode: faker.string.numeric(13),
    price: faker.commerce.price({ min: 10, max: 500 }),
    compareAtPrice: faker.commerce.price({ min: 500, max: 1000 }),
    currencyCode: 'RON',
    cost: faker.commerce.price({ min: 5, max: 100 }),
    weight: faker.number.float({ min: 0.1, max: 5, fractionDigits: 2 }).toString(),
    weightUnit: 'KILOGRAMS',
    inventoryQuantity: faker.number.int({ min: 0, max: 100 }),
    inventoryPolicy: 'DENY',
    taxable: true,
    availableForSale: true,
    requiresShipping: true,
    position: variantIndex + 1,
    selectedOptions: [{ name: 'Size', value: size }],
    metafields: {},
    createdAtShopify: faker.date.past({ years: 2 }),
    updatedAtShopify: faker.date.recent({ days: 30 }),
  };
}

// ============================================
// Main Seed Function
// ============================================
export async function seedProducts(): Promise<void> {
  console.info('🌱 Starting seed: 10K products (deterministic)...');
  const startTime = Date.now();

  try {
    // Step 1: Create shops
    console.info('📦 Creating 5 test shops...');
    const createdShops: string[] = [];

    for (let i = 0; i < SHOPS_COUNT; i++) {
      const shopData = generateShop(SHOP_CONFIGS[i]!, i);

      const [inserted] = await db
        .insert(shops)
        .values(shopData)
        .onConflictDoUpdate({
          target: shops.shopifyDomain,
          set: { updatedAt: new Date() },
        })
        .returning({ id: shops.id });

      if (inserted) {
        createdShops.push(inserted.id);
        console.info(`   ✅ Shop ${i + 1}: ${shopData.shopifyDomain}`);
      }
    }

    // Step 2: Create products and variants for each shop
    let totalProducts = 0;
    let totalVariants = 0;

    for (let shopIndex = 0; shopIndex < SHOPS_COUNT; shopIndex++) {
      const shopId = createdShops[shopIndex]!;
      console.info(`\n📦 Seeding products for Shop ${shopIndex + 1}...`);

      // Bypass RLS by setting shop context
      await pool.query(`SELECT set_config('app.current_shop_id', $1, false)`, [shopId]);

      let productBatch: NewShopifyProduct[] = [];
      const productIds: string[] = [];

      for (let productIndex = 0; productIndex < PRODUCTS_PER_SHOP; productIndex++) {
        productBatch.push(generateProduct(shopId, shopIndex, productIndex));

        // Insert in batches
        if (productBatch.length >= BATCH_SIZE || productIndex === PRODUCTS_PER_SHOP - 1) {
          const inserted = await db
            .insert(shopifyProducts)
            .values(productBatch)
            .onConflictDoNothing()
            .returning({ id: shopifyProducts.id });

          productIds.push(...inserted.map((p) => p.id));
          totalProducts += inserted.length;
          productBatch = [];

          if ((productIndex + 1) % 500 === 0) {
            console.info(`   ... ${productIndex + 1} products`);
          }
        }
      }

      // Create variants for products
      let variantBatch: NewShopifyVariant[] = [];

      for (let productIndex = 0; productIndex < productIds.length; productIndex++) {
        const productId = productIds[productIndex]!;
        // Deterministic variant count: 1-3
        const variantCount = ((shopIndex * PRODUCTS_PER_SHOP + productIndex) % 3) + 1;

        for (let variantIndex = 0; variantIndex < variantCount; variantIndex++) {
          variantBatch.push(
            generateVariant(shopId, productId, shopIndex, productIndex, variantIndex)
          );

          if (variantBatch.length >= BATCH_SIZE) {
            await db.insert(shopifyVariants).values(variantBatch).onConflictDoNothing();
            totalVariants += variantBatch.length;
            variantBatch = [];
          }
        }
      }

      // Insert remaining variants
      if (variantBatch.length > 0) {
        await db.insert(shopifyVariants).values(variantBatch).onConflictDoNothing();
        totalVariants += variantBatch.length;
      }

      console.info(`   ✅ Shop ${shopIndex + 1}: ${PRODUCTS_PER_SHOP} products, variants created`);
    }

    // Reset RLS context
    await pool.query(`SELECT set_config('app.current_shop_id', '', false)`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.info(`\n✅ Seed complete in ${elapsed}s`);
    console.info(`   📊 Shops: ${SHOPS_COUNT}`);
    console.info(`   📊 Products: ${totalProducts}`);
    console.info(`   📊 Variants: ${totalVariants}`);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  }
}

// ============================================
// CLI Entry Point
// ============================================
if (process.argv[1]?.includes('products')) {
  seedProducts()
    .then(() => {
      console.info('Script terminat cu succes');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('Script eșuat:', err);
      process.exit(1);
    });
}
