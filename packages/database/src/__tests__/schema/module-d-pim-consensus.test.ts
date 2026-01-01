/**
 * Module D (Part 2): PIM Consensus Schema Tests
 *
 * Tests for 6 PIM consensus/deduplication tables:
 * - prod_proposals
 * - prod_dedupe_clusters
 * - prod_dedupe_cluster_members
 * - prod_similarity_matches
 * - prod_quality_events
 * - prod_translations
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableInfo,
  getTableColumns,
  getTableRlsStatus,
  getTableConstraints,
  getTableTriggers,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// PROD_PROPOSALS TABLE
// ============================================

void describe('Module D: prod_proposals table', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_proposals');
    assert.ok(info, 'prod_proposals table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_proposals');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('product_id'), 'should have product_id');
    assert.ok(columnNames.includes('proposal_type'), 'should have proposal_type');
    assert.ok(columnNames.includes('proposed_value'), 'should have proposed_value');
    assert.ok(columnNames.includes('status'), 'should have status');
    assert.ok(columnNames.includes('source'), 'should have source');
    assert.ok(columnNames.includes('confidence'), 'should have confidence');
  });

  void it('has JSONB proposed_value column', async () => {
    const columns = await getTableColumns('prod_proposals');
    const proposedValue = columns.find((c) => c.column_name === 'proposed_value');
    assert.ok(proposedValue, 'proposed_value column should exist');
    assert.strictEqual(proposedValue?.udt_name, 'jsonb', 'proposed_value should be jsonb');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_proposals');
    assert.strictEqual(hasRls, false, 'prod_proposals should NOT have RLS');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('prod_proposals');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });
});

// ============================================
// PROD_DEDUPE_CLUSTERS TABLE
// ============================================

void describe('Module D: prod_dedupe_clusters table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_dedupe_clusters');
    assert.ok(info, 'prod_dedupe_clusters table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_dedupe_clusters');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('canonical_product_id'), 'should have canonical_product_id');
    assert.ok(columnNames.includes('status'), 'should have status');
    assert.ok(columnNames.includes('confidence'), 'should have confidence');
    assert.ok(columnNames.includes('member_count'), 'should have member_count');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_dedupe_clusters');
    assert.strictEqual(hasRls, false, 'prod_dedupe_clusters should NOT have RLS');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('prod_dedupe_clusters');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });
});

// ============================================
// PROD_DEDUPE_CLUSTER_MEMBERS TABLE
// ============================================

void describe('Module D: prod_dedupe_cluster_members table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_dedupe_cluster_members');
    assert.ok(info, 'prod_dedupe_cluster_members table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_dedupe_cluster_members');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('cluster_id'), 'should have cluster_id');
    assert.ok(columnNames.includes('product_id'), 'should have product_id');
    assert.ok(columnNames.includes('similarity_score'), 'should have similarity_score');
    assert.ok(columnNames.includes('is_canonical'), 'should have is_canonical');
  });

  void it('has FK to prod_dedupe_clusters', async () => {
    const constraints = await getTableConstraints('prod_dedupe_cluster_members');
    const fk = constraints.find((c) => c.constraint_type === 'FOREIGN KEY');
    assert.ok(fk, 'should have foreign key to cluster');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_dedupe_cluster_members');
    assert.strictEqual(hasRls, false, 'prod_dedupe_cluster_members should NOT have RLS');
  });
});

// ============================================
// PROD_SIMILARITY_MATCHES TABLE
// ============================================

void describe('Module D: prod_similarity_matches table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_similarity_matches');
    assert.ok(info, 'prod_similarity_matches table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_similarity_matches');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('product_a_id'), 'should have product_a_id');
    assert.ok(columnNames.includes('product_b_id'), 'should have product_b_id');
    assert.ok(columnNames.includes('similarity_score'), 'should have similarity_score');
    assert.ok(columnNames.includes('match_type'), 'should have match_type');
    assert.ok(columnNames.includes('status'), 'should have status');
  });

  void it('has unique constraint on product pair', async () => {
    const constraints = await getTableConstraints('prod_similarity_matches');
    const unique = constraints.find((c) => c.constraint_type === 'UNIQUE');
    assert.ok(unique, 'should have unique constraint on product pair');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_similarity_matches');
    assert.strictEqual(hasRls, false, 'prod_similarity_matches should NOT have RLS');
  });
});

// ============================================
// PROD_QUALITY_EVENTS TABLE
// ============================================

void describe('Module D: prod_quality_events table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_quality_events');
    assert.ok(info, 'prod_quality_events table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_quality_events');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('product_id'), 'should have product_id');
    assert.ok(columnNames.includes('event_type'), 'should have event_type');
    assert.ok(columnNames.includes('old_score'), 'should have old_score');
    assert.ok(columnNames.includes('new_score'), 'should have new_score');
    assert.ok(columnNames.includes('reason'), 'should have reason');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_quality_events');
    assert.strictEqual(hasRls, false, 'prod_quality_events should NOT have RLS');
  });
});

// ============================================
// PROD_TRANSLATIONS TABLE
// ============================================

void describe('Module D: prod_translations table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_translations');
    assert.ok(info, 'prod_translations table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_translations');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('product_id'), 'should have product_id');
    assert.ok(columnNames.includes('locale'), 'should have locale');
    assert.ok(columnNames.includes('field_name'), 'should have field_name');
    assert.ok(columnNames.includes('translated_value'), 'should have translated_value');
  });

  void it('has unique constraint on product/locale/field', async () => {
    const constraints = await getTableConstraints('prod_translations');
    const unique = constraints.find((c) => c.constraint_type === 'UNIQUE');
    assert.ok(unique, 'should have unique constraint');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_translations');
    assert.strictEqual(hasRls, false, 'prod_translations should NOT have RLS');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('prod_translations');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });
});
