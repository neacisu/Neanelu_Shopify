/*
 * PR-043 Dry Run (real DB)
 *
 * Seeds a minimal Shopify + staging dataset, then runs runPimSyncFromBulkRun
 * to validate:
 * - prod_channel_mappings write (RLS / tenant context)
 * - consensus -> prod_specs_normalized snapshot + provenance
 * - dedupe cluster persistence (prod_dedupe_clusters + members)
 *
 * Usage (recommended):
 *   POSTGRES_USER=shopify POSTGRES_PASSWORD=shopify_dev_password POSTGRES_DB=neanelu_shopify \
 *   docker compose --env-file .env.example -f docker-compose.yml -f docker-compose.dev.yml up -d db redis
 *
 *   DATABASE_URL=postgresql://shopify:shopify_dev_password@localhost:65010/neanelu_shopify \
 *   REDIS_URL=redis://localhost:65011 \
 *   APP_HOST=https://localhost:65000 \
 *   SHOPIFY_API_KEY=dev SHOPIFY_API_SECRET=dev SCOPES=read_products \
 *   ENCRYPTION_KEY_VERSION=1 ENCRYPTION_KEY_256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
 *   BULLMQ_PRO_TOKEN=dev \
 *   BULK_PIM_SYNC_ENABLED=1 BULK_CONSENSUS_ENABLED=1 BULK_SEMANTIC_DEDUP_ENABLED=0 \
 *   node --import tsx scripts/pr043-dry-run.ts
 */

export {};

const SHOP_ID = '00000000-0000-0000-0000-000000000001';
const BULK_RUN_ID = '00000000-0000-0000-0000-000000000002';

const SHOPIFY_PRODUCT_ID = '00000000-0000-0000-0000-000000000010';
const SHOPIFY_VARIANT_ID = '00000000-0000-0000-0000-000000000011';
const SHOPIFY_GID = 'gid://shopify/Product/1001';

const EXISTING_PIM_ID = '00000000-0000-0000-0000-000000000020';

const CANONICAL_PIM_ID = '00000000-0000-0000-0000-000000000030';
const SUSPICIOUS_PIM_ID = '00000000-0000-0000-0000-000000000031';

function applyEnvDefaults(): void {
  // IMPORTANT: @app/database reads DATABASE_URL at import-time.
  // This script is written to use dynamic imports after defaults are applied.

  const setDefault = (key: string, value: string): void => {
    const current = process.env[key];
    if (current == null || current.trim() === '') {
      process.env[key] = value;
    }
  };

  setDefault('NODE_ENV', 'development');
  setDefault('LOG_LEVEL', 'info');
  setDefault('PORT', '65000');

  setDefault('APP_HOST', 'https://localhost:65000');
  setDefault(
    'DATABASE_URL',
    'postgresql://shopify:shopify_dev_password@localhost:65010/neanelu_shopify'
  );
  setDefault('REDIS_URL', 'redis://localhost:65011');
  setDefault('BULLMQ_PRO_TOKEN', 'dev');

  setDefault('SHOPIFY_API_KEY', 'dev');
  setDefault('SHOPIFY_API_SECRET', 'dev');
  setDefault('SCOPES', 'read_products');

  setDefault('ENCRYPTION_KEY_VERSION', '1');
  setDefault(
    'ENCRYPTION_KEY_256',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  );

  // PR-043 kill-switches
  setDefault('BULK_PIM_SYNC_ENABLED', '1');
  setDefault('BULK_CONSENSUS_ENABLED', '1');
  setDefault('BULK_SEMANTIC_DEDUP_ENABLED', '0');
}

applyEnvDefaults();

const { createLogger } = await import('@app/logger');
const { withTenantContext, closePool, pool } = await import('@app/database');
const { runPimSyncFromBulkRun } =
  await import('../apps/backend-worker/src/processors/bulk-operations/pim/sync.js');
const { createSuspiciousDedupeCluster } =
  await import('../apps/backend-worker/src/processors/bulk-operations/deduplication.js');

const logger = createLogger({
  service: 'pr043-dry-run',
  env: 'development',
  level: 'info',
});

async function seedBaseData(): Promise<void> {
  // feature_flags is a global table (no RLS)
  {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO feature_flags (flag_key, description, default_value, is_active, rollout_percentage, allowed_shop_ids, blocked_shop_ids)
         VALUES
           ('bulk.pim_sync.enabled', 'PR-043: PIM sync', false, true, 0, $1::uuid[], '{}'::uuid[]),
           ('bulk.consensus.enabled', 'PR-043: consensus', false, true, 0, $1::uuid[], '{}'::uuid[])
         ON CONFLICT (flag_key)
         DO UPDATE SET
           is_active = EXCLUDED.is_active,
           default_value = EXCLUDED.default_value,
           rollout_percentage = EXCLUDED.rollout_percentage,
           allowed_shop_ids = EXCLUDED.allowed_shop_ids,
           blocked_shop_ids = EXCLUDED.blocked_shop_ids,
           updated_at = now()`,
        [[SHOP_ID]]
      );

      // Minimal shop row (shops is global; required columns must be present)
      await client.query(
        `INSERT INTO shops (
           id,
           shopify_domain,
           shopify_shop_id,
           access_token_ciphertext,
           access_token_iv,
           access_token_tag,
           scopes,
           created_at,
           updated_at
         )
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::text[], now(), now())
         ON CONFLICT (id)
         DO UPDATE SET
           shopify_domain = EXCLUDED.shopify_domain,
           scopes = EXCLUDED.scopes,
           updated_at = now()`,
        [SHOP_ID, 'dry-run.myshopify.com', 1001, 'x', 'x', 'x', ['read_products']]
      );

      // Existing PIM record for GTIN exact match
      await client.query(
        `INSERT INTO prod_master (
           id,
           internal_sku,
           canonical_title,
           brand,
           gtin,
           dedupe_status,
           data_quality_level,
           needs_review,
           created_at,
           updated_at
         )
         VALUES ($1::uuid, 'gtin:123', 'Existing PIM Product', 'ACME', '123', 'unique', 'bronze', false, now(), now())
         ON CONFLICT (id)
         DO UPDATE SET
           canonical_title = EXCLUDED.canonical_title,
           brand = EXCLUDED.brand,
           gtin = EXCLUDED.gtin,
           updated_at = now()`,
        [EXISTING_PIM_ID]
      );
    } finally {
      client.release();
    }
  }

  // Shop-scoped rows (RLS enforced)
  await withTenantContext(SHOP_ID, async (client) => {
    // Clean previous seed for idempotency
    await client.query(`DELETE FROM staging_products WHERE bulk_run_id = $1::uuid`, [BULK_RUN_ID]);
    await client.query(`DELETE FROM shopify_variants WHERE id = $1::uuid`, [SHOPIFY_VARIANT_ID]);
    await client.query(`DELETE FROM shopify_products WHERE id = $1::uuid`, [SHOPIFY_PRODUCT_ID]);
    await client.query(`DELETE FROM bulk_runs WHERE id = $1::uuid`, [BULK_RUN_ID]);

    await client.query(
      `INSERT INTO bulk_runs (id, shop_id, operation_type, query_type, status, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, 'PRODUCTS_EXPORT', 'core', 'completed', now(), now())
       ON CONFLICT (id)
       DO UPDATE SET updated_at = now()`,
      [BULK_RUN_ID, SHOP_ID]
    );

    await client.query(
      `INSERT INTO shopify_products (
         id, shop_id, shopify_gid, legacy_resource_id,
         title, handle, status,
         created_at, updated_at, synced_at, updated_at_shopify
       )
       VALUES (
         $1::uuid, $2::uuid, $3, $4,
         $5, $6, 'ACTIVE',
         now(), now(), now(), now()
       )
       ON CONFLICT (id)
       DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
      [SHOPIFY_PRODUCT_ID, SHOP_ID, SHOPIFY_GID, 1001, 'GTIN Product From Shopify', 'gtin-product']
    );

    await client.query(
      `INSERT INTO shopify_variants (
         id, shop_id, product_id, shopify_gid, legacy_resource_id,
         title, barcode, price, compare_at_price,
         created_at, updated_at, synced_at, updated_at_shopify
       )
       VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4, $5,
         $6, $7, 10.00, 10.00,
         now(), now(), now(), now()
       )
       ON CONFLICT (id)
       DO UPDATE SET barcode = EXCLUDED.barcode, updated_at = now()`,
      [
        SHOPIFY_VARIANT_ID,
        SHOP_ID,
        SHOPIFY_PRODUCT_ID,
        'gid://shopify/ProductVariant/2001',
        2001,
        'Default Title',
        '123',
      ]
    );

    await client.query(
      `INSERT INTO staging_products (
         bulk_run_id, shop_id, shopify_gid, legacy_resource_id,
         title, handle, vendor, status,
         validation_status, merge_status,
         target_product_id,
         imported_at
       )
       VALUES (
         $1::uuid, $2::uuid, $3, $4,
         $5, $6, $7, 'ACTIVE',
         'valid', 'merged',
         $8::uuid,
         now()
       )`,
      [
        BULK_RUN_ID,
        SHOP_ID,
        SHOPIFY_GID,
        1001,
        'GTIN Product From Shopify',
        'gtin-product',
        'ACME',
        SHOPIFY_PRODUCT_ID,
      ]
    );
  });
}

async function verifyPimSyncEffects(): Promise<void> {
  await withTenantContext(SHOP_ID, async (client) => {
    const mapRes = await client.query<Readonly<{ product_id: string; channel_meta: unknown }>>(
      `SELECT product_id::text, channel_meta
       FROM prod_channel_mappings
       WHERE channel = 'shopify'
         AND shop_id = $1::uuid
         AND external_id = $2
       LIMIT 1`,
      [SHOP_ID, SHOPIFY_GID]
    );

    const mapping = mapRes.rows[0];
    if (!mapping) throw new Error('expected prod_channel_mappings row not found');
    if (mapping.product_id !== EXISTING_PIM_ID) {
      throw new Error(
        `expected mapping to EXISTING_PIM_ID (${EXISTING_PIM_ID}), got ${mapping.product_id}`
      );
    }

    const specsRes = await client.query<
      Readonly<{ version: number; provenance: unknown; needs_review: boolean }>
    >(
      `SELECT version, provenance, needs_review
       FROM prod_specs_normalized
       WHERE product_id = $1::uuid
         AND is_current = true
       ORDER BY version DESC
       LIMIT 1`,
      [EXISTING_PIM_ID]
    );

    const specs = specsRes.rows[0];
    if (!specs) throw new Error('expected prod_specs_normalized current row not found');

    logger.info(
      {
        mapping,
        specs: {
          version: specs.version,
          needs_review: specs.needs_review,
          provenance: specs.provenance,
        },
      },
      '✅ PIM sync verified: mapping + consensus snapshot'
    );
  });
}

async function seedAndVerifyDedupeCluster(): Promise<void> {
  const client = await pool.connect();
  try {
    // Clean prior cluster artifacts for idempotency (global tables)
    await client.query(
      `DELETE FROM prod_dedupe_cluster_members WHERE product_id IN ($1::uuid, $2::uuid)`,
      [CANONICAL_PIM_ID, SUSPICIOUS_PIM_ID]
    );
    await client.query(
      `DELETE FROM prod_dedupe_clusters
       WHERE canonical_product_id IN ($1::uuid, $2::uuid)`,
      [CANONICAL_PIM_ID, SUSPICIOUS_PIM_ID]
    );

    await client.query(
      `INSERT INTO prod_master (id, internal_sku, canonical_title, dedupe_status, data_quality_level, needs_review, created_at, updated_at)
       VALUES
         ($1::uuid, 'seed:canonical', 'Canonical Product', 'unique', 'bronze', false, now(), now()),
         ($2::uuid, 'seed:suspicious', 'Suspicious Product', 'pending', 'bronze', false, now(), now())
       ON CONFLICT (id)
       DO UPDATE SET canonical_title = EXCLUDED.canonical_title, updated_at = now()`,
      [CANONICAL_PIM_ID, SUSPICIOUS_PIM_ID]
    );

    const clusterId = await createSuspiciousDedupeCluster({
      client,
      canonicalProductId: CANONICAL_PIM_ID,
      newProductId: SUSPICIOUS_PIM_ID,
      similarity: 0.9,
      matchCriteria: { method: 'semantic', threshold: 0.85, similarity: 0.9 },
      matchFields: { canonical_title: 'Suspicious Product' },
    });

    await client.query(
      `UPDATE prod_master
       SET
         dedupe_status = 'suspicious',
         dedupe_cluster_id = $2::uuid,
         needs_review = true,
         review_notes = 'dry-run: semantic suspicious cluster',
         data_quality_level = 'review_needed',
         updated_at = now()
       WHERE id = $1::uuid`,
      [SUSPICIOUS_PIM_ID, clusterId]
    );

    const clusterRes = await client.query<
      Readonly<{ id: string; status: string; confidence_score: number }>
    >(
      `SELECT id::text, status, confidence_score
       FROM prod_dedupe_clusters
       WHERE id = $1::uuid`,
      [clusterId]
    );

    const membersRes = await client.query<
      Readonly<{ product_id: string; is_canonical: boolean; similarity_score: number }>
    >(
      `SELECT product_id::text, is_canonical, similarity_score
       FROM prod_dedupe_cluster_members
       WHERE cluster_id = $1::uuid
       ORDER BY is_canonical DESC`,
      [clusterId]
    );

    logger.info(
      {
        clusterId,
        cluster: clusterRes.rows[0],
        members: membersRes.rows,
      },
      '✅ Dedupe cluster verified: clusters + members'
    );
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  logger.info(
    {
      shopId: SHOP_ID,
      bulkRunId: BULK_RUN_ID,
      databaseUrl: process.env['DATABASE_URL'] ? '[set]' : '[missing]',
    },
    'Starting PR-043 dry run'
  );

  await seedBaseData();

  await runPimSyncFromBulkRun({
    shopId: SHOP_ID,
    bulkRunId: BULK_RUN_ID,
    logger,
  });

  await verifyPimSyncEffects();
  await seedAndVerifyDedupeCluster();

  logger.info({}, 'PR-043 dry run completed successfully');
}

try {
  await main();
} finally {
  await closePool().catch(() => undefined);
}
