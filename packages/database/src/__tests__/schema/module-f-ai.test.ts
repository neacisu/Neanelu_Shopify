/**
 * Module F: AI Batch Schema Tests
 *
 * Tests for 3 AI batch processing tables:
 * - ai_batches
 * - ai_batch_items
 * - embedding_batches
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableInfo,
  getTableColumns,
  getTableIndexes,
  getTableRlsStatus,
  getTableConstraints,
  getTableTriggers,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// AI_BATCHES TABLE
// ============================================

void describe('Module F: ai_batches table', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('ai_batches');
    assert.ok(info, 'ai_batches table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('ai_batches');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('batch_type'), 'should have batch_type');
    assert.ok(columnNames.includes('status'), 'should have status');
    assert.ok(columnNames.includes('provider'), 'should have provider');
    assert.ok(columnNames.includes('request_count'), 'should have request_count');
    assert.ok(columnNames.includes('completed_count'), 'should have completed_count');
    assert.ok(columnNames.includes('error_count'), 'should have error_count');
  });

  void it('has correct column types', async () => {
    const columns = await getTableColumns('ai_batches');
    const columnMap = new Map(columns.map((c) => [c.column_name, c]));

    assert.strictEqual(columnMap.get('id')?.udt_name, 'uuid', 'id should be uuid');
    assert.strictEqual(columnMap.get('shop_id')?.udt_name, 'uuid', 'shop_id should be uuid');
    assert.strictEqual(
      columnMap.get('cost_usd')?.udt_name,
      'numeric',
      'cost_usd should be numeric'
    );
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('ai_batches');
    assert.strictEqual(hasRls, true, 'ai_batches should have RLS enabled');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('ai_batches');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });

  void it('has required indexes', async () => {
    const indexes = await getTableIndexes('ai_batches');
    const indexNames = indexes.map((i) => i.indexname);

    assert.ok(
      indexNames.some((n) => n.includes('pkey')),
      'should have primary key index'
    );
    assert.ok(
      indexNames.some((n) => n.includes('shop_id') || n.includes('status')),
      'should have index for shop_id or status lookup'
    );
  });
});

// ============================================
// AI_BATCH_ITEMS TABLE
// ============================================

void describe('Module F: ai_batch_items table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('ai_batch_items');
    assert.ok(info, 'ai_batch_items table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('ai_batch_items');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('batch_id'), 'should have batch_id');
    assert.ok(columnNames.includes('input_content'), 'should have input_content');
    assert.ok(columnNames.includes('output_content'), 'should have output_content');
    assert.ok(columnNames.includes('status'), 'should have status');
    assert.ok(columnNames.includes('error_message'), 'should have error_message');
    assert.ok(columnNames.includes('tokens_used'), 'should have tokens_used');
  });

  void it('has TEXT columns for input/output content', async () => {
    const columns = await getTableColumns('ai_batch_items');
    const columnMap = new Map(columns.map((c) => [c.column_name, c]));

    assert.strictEqual(
      columnMap.get('input_content')?.udt_name,
      'text',
      'input_content should be text'
    );
    // output_content can be null
    assert.ok(columnMap.has('output_content'), 'output_content should exist');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('ai_batch_items');
    assert.strictEqual(hasRls, true, 'ai_batch_items should have RLS enabled');
  });

  void it('has FK to ai_batches', async () => {
    const constraints = await getTableConstraints('ai_batch_items');
    const fk = constraints.find((c) => c.constraint_type === 'FOREIGN KEY');
    assert.ok(fk, 'should have foreign key to ai_batches');
  });
});

// ============================================
// EMBEDDING_BATCHES TABLE
// ============================================

void describe('Module F: embedding_batches table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('embedding_batches');
    assert.ok(info, 'embedding_batches table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('embedding_batches');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('batch_type'), 'should have batch_type');
    assert.ok(columnNames.includes('openai_batch_id'), 'should have openai_batch_id');
    assert.ok(columnNames.includes('status'), 'should have status');
    assert.ok(columnNames.includes('dimensions'), 'should have dimensions');
    assert.ok(columnNames.includes('model'), 'should have model');
    assert.ok(columnNames.includes('total_items'), 'should have total_items');
    assert.ok(columnNames.includes('completed_items'), 'should have completed_items');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('embedding_batches');
    assert.strictEqual(hasRls, true, 'embedding_batches should have RLS enabled');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('embedding_batches');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });
});
