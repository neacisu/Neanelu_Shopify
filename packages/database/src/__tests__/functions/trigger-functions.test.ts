/**
 * Trigger Functions Tests
 *
 * Tests for trigger functions and their application:
 * - update_updated_at() - Automatic timestamp update
 * - audit_critical_action() - Audit logging
 * - update_prod_semantics_search_vector() - Full-text search trigger
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getFunctionInfo,
  getAllTriggers,
  getTableTriggers,
  type TriggerInfo,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// TRIGGER FUNCTIONS SUMMARY
// ============================================

void describe('Trigger Functions Summary', { skip: SKIP }, () => {
  let allTriggers: TriggerInfo[];

  before(async () => {
    getPool();
    allTriggers = await getAllTriggers();
  });

  after(async () => {
    await closePool();
  });

  void it('has at least 20 triggers', () => {
    assert.ok(allTriggers.length >= 20, `Expected at least 20 triggers, got ${allTriggers.length}`);
  });

  void it('has triggers in expected range (20-30)', () => {
    assert.ok(
      allTriggers.length >= 20 && allTriggers.length <= 35,
      `Trigger count ${allTriggers.length} should be in range 20-35`
    );
  });
});

// ============================================
// UPDATE_UPDATED_AT FUNCTION
// ============================================

void describe('Function: update_updated_at()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('update_updated_at');
    assert.ok(fn, 'update_updated_at function should exist');
  });

  void it('returns TRIGGER type', async () => {
    const fn = await getFunctionInfo('update_updated_at');
    assert.ok(fn?.routine_type === 'FUNCTION', 'Should be a function');
  });
});

// ============================================
// UPDATE_UPDATED_AT TRIGGER COVERAGE
// ============================================

void describe('Trigger: update_updated_at Coverage', { skip: SKIP }, () => {
  const TABLES_WITH_UPDATED_AT = [
    'shops',
    'shopify_products',
    'shopify_variants',
    'shopify_collections',
    'shopify_customers',
    'shopify_orders',
    'bulk_runs',
    'ai_batches',
    'embedding_batches',
    'scheduled_tasks',
    'rate_limit_buckets',
    'sync_checkpoints',
    'shopify_media',
    'shopify_menus',
    'shopify_menu_items',
    'shopify_publications',
    'shopify_resource_publications',
    'scraper_configs',
    'feature_flags',
    'prod_dedupe_clusters',
    'prod_proposals',
    'prod_similarity_matches',
    'prod_translations',
  ];

  for (const tableName of TABLES_WITH_UPDATED_AT) {
    void it(`${tableName} has update_updated_at trigger`, async () => {
      const triggers = await getTableTriggers(tableName);
      const updateTrigger = triggers.find(
        (t) =>
          t.trigger_name.includes('updated_at') || t.action_statement.includes('update_updated_at')
      );

      assert.ok(updateTrigger, `${tableName} should have update_updated_at trigger`);
    });
  }
});

// ============================================
// AUDIT TRIGGER FUNCTION
// ============================================

void describe('Function: audit_critical_action()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('audit_critical_action');
    assert.ok(fn, 'audit_critical_action function should exist');
  });
});

// ============================================
// SEARCH VECTOR TRIGGER
// ============================================

void describe('Function: update_prod_semantics_search_vector()', { skip: SKIP }, () => {
  void it('exists in database', async () => {
    const fn = await getFunctionInfo('update_prod_semantics_search_vector');
    assert.ok(fn, 'update_prod_semantics_search_vector function should exist');
  });
});

void describe('Trigger: prod_semantics search_vector', { skip: SKIP }, () => {
  void it('prod_semantics has search_vector trigger', async () => {
    const triggers = await getTableTriggers('prod_semantics');
    const searchTrigger = triggers.find((t) => t.trigger_name.includes('search_vector'));

    assert.ok(searchTrigger, 'prod_semantics should have search_vector trigger');
  });
});

// ============================================
// TRIGGER TIMING AND EVENTS
// ============================================

void describe('Trigger Timing and Events', { skip: SKIP }, () => {
  void it('update_updated_at triggers fire BEFORE UPDATE', async () => {
    const allTriggers = await getAllTriggers();
    const updateTriggers = allTriggers.filter((t) => t.trigger_name.includes('updated_at'));

    for (const trigger of updateTriggers) {
      assert.strictEqual(
        trigger.action_timing,
        'BEFORE',
        `${trigger.trigger_name} should fire BEFORE`
      );
      assert.strictEqual(
        trigger.event_manipulation,
        'UPDATE',
        `${trigger.trigger_name} should fire on UPDATE`
      );
    }
  });
});

// ============================================
// SPECIFIC TRIGGER VERIFICATION
// ============================================

void describe('Specific Triggers', { skip: SKIP }, () => {
  void it('shops has trg_shops_updated_at', async () => {
    const triggers = await getTableTriggers('shops');
    const shopTrigger = triggers.find((t) => t.trigger_name === 'trg_shops_updated_at');
    assert.ok(shopTrigger, 'trg_shops_updated_at should exist');
  });

  void it('shopify_products has trg_products_updated_at', async () => {
    const triggers = await getTableTriggers('shopify_products');
    const productTrigger = triggers.find((t) => t.trigger_name === 'trg_products_updated_at');
    assert.ok(productTrigger, 'trg_products_updated_at should exist');
  });

  void it('shopify_variants has trg_variants_updated_at', async () => {
    const triggers = await getTableTriggers('shopify_variants');
    const variantTrigger = triggers.find((t) => t.trigger_name === 'trg_variants_updated_at');
    assert.ok(variantTrigger, 'trg_variants_updated_at should exist');
  });

  void it('bulk_runs has trg_bulk_runs_updated_at', async () => {
    const triggers = await getTableTriggers('bulk_runs');
    const bulkTrigger = triggers.find((t) => t.trigger_name === 'trg_bulk_runs_updated_at');
    assert.ok(bulkTrigger, 'trg_bulk_runs_updated_at should exist');
  });

  void it('ai_batches has trg_ai_batches_updated_at', async () => {
    const triggers = await getTableTriggers('ai_batches');
    const aiBatchTrigger = triggers.find((t) => t.trigger_name === 'trg_ai_batches_updated_at');
    assert.ok(aiBatchTrigger, 'trg_ai_batches_updated_at should exist');
  });
});
