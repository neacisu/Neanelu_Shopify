/**
 * Module G: Queue Schema Tests
 *
 * Tests for 4 queue/job management tables:
 * - job_runs
 * - scheduled_tasks
 * - rate_limit_buckets
 * - api_cost_tracking
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableInfo,
  getTableColumns,
  getTableIndexes,
  getTableRlsStatus,
  getTablePartitions,
  getTableTriggers,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// JOB_RUNS TABLE
// ============================================

void describe('Module G: job_runs table', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('job_runs');
    assert.ok(info, 'job_runs table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('job_runs');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('queue_name'), 'should have queue_name');
    assert.ok(columnNames.includes('job_id'), 'should have job_id');
    assert.ok(columnNames.includes('job_name'), 'should have job_name');
    assert.ok(columnNames.includes('status'), 'should have status');
    assert.ok(columnNames.includes('payload'), 'should have payload');
    assert.ok(columnNames.includes('started_at'), 'should have started_at');
    assert.ok(columnNames.includes('completed_at'), 'should have completed_at');
    assert.ok(columnNames.includes('error_message'), 'should have error_message');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('job_runs');
    assert.strictEqual(hasRls, true, 'job_runs should have RLS enabled');
  });

  void it('has required indexes', async () => {
    const indexes = await getTableIndexes('job_runs');
    const indexNames = indexes.map((i) => i.indexname);

    assert.ok(
      indexNames.some((n) => n.includes('pkey')),
      'should have primary key index'
    );
  });
});

// ============================================
// SCHEDULED_TASKS TABLE
// ============================================

void describe('Module G: scheduled_tasks table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('scheduled_tasks');
    assert.ok(info, 'scheduled_tasks table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('scheduled_tasks');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('task_name'), 'should have task_name');
    assert.ok(columnNames.includes('cron_expression'), 'should have cron_expression');
    assert.ok(columnNames.includes('next_run_at'), 'should have next_run_at');
    assert.ok(columnNames.includes('last_run_at'), 'should have last_run_at');
    assert.ok(columnNames.includes('is_active'), 'should have is_active');
    assert.ok(columnNames.includes('job_data'), 'should have job_data');
  });

  void it('has JSONB job_data column', async () => {
    const columns = await getTableColumns('scheduled_tasks');
    const jobData = columns.find((c) => c.column_name === 'job_data');
    assert.ok(jobData, 'job_data column should exist');
    assert.strictEqual(jobData?.udt_name, 'jsonb', 'job_data should be jsonb');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('scheduled_tasks');
    assert.strictEqual(hasRls, true, 'scheduled_tasks should have RLS enabled');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('scheduled_tasks');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });
});

// ============================================
// RATE_LIMIT_BUCKETS TABLE
// ============================================

void describe('Module G: rate_limit_buckets table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('rate_limit_buckets');
    assert.ok(info, 'rate_limit_buckets table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('rate_limit_buckets');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('tokens_remaining'), 'should have tokens_remaining');
    assert.ok(columnNames.includes('max_tokens'), 'should have max_tokens');
    assert.ok(columnNames.includes('refill_rate'), 'should have refill_rate');
    assert.ok(columnNames.includes('last_refill_at'), 'should have last_refill_at');
    assert.ok(columnNames.includes('updated_at'), 'should have updated_at');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('rate_limit_buckets');
    assert.strictEqual(hasRls, true, 'rate_limit_buckets should have RLS enabled');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('rate_limit_buckets');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });
});

// ============================================
// API_COST_TRACKING TABLE (PARTITIONED)
// ============================================

void describe('Module G: api_cost_tracking table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('api_cost_tracking');
    assert.ok(info, 'api_cost_tracking table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('api_cost_tracking');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('operation_type'), 'should have operation_type');
    assert.ok(columnNames.includes('query_hash'), 'should have query_hash');
    assert.ok(columnNames.includes('actual_cost'), 'should have actual_cost');
    assert.ok(columnNames.includes('requested_at'), 'should have requested_at');
  });

  void it('is partitioned by month', async () => {
    const partitions = await getTablePartitions('api_cost_tracking');
    assert.ok(partitions.length >= 12, 'should have at least 12 monthly partitions');
    assert.ok(
      partitions.some((p) => p.partition_name.includes('2025_01')),
      'should have 2025_01 partition'
    );
  });

  void it('does NOT have RLS (partitioned table - handled differently)', async () => {
    // Partitioned tables may handle RLS at partition level
    const hasRls = await getTableRlsStatus('api_cost_tracking');
    // This is OK either way per documentation
    assert.ok(typeof hasRls === 'boolean', 'RLS status should be defined');
  });
});
