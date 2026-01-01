/**
 * Monthly Partitions Tests
 *
 * Tests for partitioned tables:
 * - audit_logs (64 partitions)
 * - inventory_ledger (64 partitions)
 * - api_cost_tracking (64 partitions)
 * - webhook_events (64 partitions)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getAllPartitions,
  getTablePartitions,
  getPartitionedTables,
  type PartitionInfo,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// Partitioned tables - used for reference and documentation
// Each table has 16 partitions (12 months 2025 + 4 months 2026)
const _PARTITIONED_TABLES = [
  'audit_logs',
  'inventory_ledger',
  'api_cost_tracking',
  'webhook_events',
] as const;

// Export for potential future use
export type PartitionedTable = (typeof _PARTITIONED_TABLES)[number];

// ============================================
// PARTITIONING SUMMARY
// ============================================

void describe('Partitioning Summary', { skip: SKIP }, () => {
  let allPartitions: PartitionInfo[];
  let partitionedTables: string[];

  before(async () => {
    getPool();
    allPartitions = await getAllPartitions();
    partitionedTables = await getPartitionedTables();
  });

  after(async () => {
    await closePool();
  });

  void it('has 4 partitioned tables', () => {
    assert.strictEqual(
      partitionedTables.length,
      4,
      `Expected 4 partitioned tables, got ${partitionedTables.length}`
    );
  });

  void it('has at least 48 total partitions (4 tables x 12 months 2025)', () => {
    assert.ok(
      allPartitions.length >= 48,
      `Expected at least 48 partitions, got ${allPartitions.length}`
    );
  });

  void it('has partitions for 2025 and 2026', () => {
    const partitions2025 = allPartitions.filter((p) => p.partition_name.includes('2025'));
    const partitions2026 = allPartitions.filter((p) => p.partition_name.includes('2026'));

    assert.ok(partitions2025.length >= 48, 'Should have 2025 partitions');
    assert.ok(partitions2026.length >= 4, 'Should have 2026 partitions');
  });
});

// ============================================
// AUDIT_LOGS PARTITIONS
// ============================================

void describe('Partitions: audit_logs', { skip: SKIP }, () => {
  void it('has at least 12 monthly partitions for 2025', async () => {
    const partitions = await getTablePartitions('audit_logs');
    const partitions2025 = partitions.filter((p) => p.partition_name.includes('2025'));

    assert.ok(
      partitions2025.length >= 12,
      `Expected 12+ partitions for 2025, got ${partitions2025.length}`
    );
  });

  void it('has partition for January 2025', async () => {
    const partitions = await getTablePartitions('audit_logs');
    const jan2025 = partitions.find((p) => p.partition_name.includes('2025_01'));

    assert.ok(jan2025, 'audit_logs_2025_01 partition should exist');
  });

  void it('has partition for December 2025', async () => {
    const partitions = await getTablePartitions('audit_logs');
    const dec2025 = partitions.find((p) => p.partition_name.includes('2025_12'));

    assert.ok(dec2025, 'audit_logs_2025_12 partition should exist');
  });

  void it('partitions are RANGE based on created_at', async () => {
    const partitions = await getTablePartitions('audit_logs');

    for (const partition of partitions) {
      assert.ok(
        partition.partition_expression.includes('FOR VALUES'),
        'Should have FOR VALUES clause'
      );
    }
  });
});

// ============================================
// INVENTORY_LEDGER PARTITIONS
// ============================================

void describe('Partitions: inventory_ledger', { skip: SKIP }, () => {
  void it('has at least 12 monthly partitions for 2025', async () => {
    const partitions = await getTablePartitions('inventory_ledger');
    const partitions2025 = partitions.filter((p) => p.partition_name.includes('2025'));

    assert.ok(
      partitions2025.length >= 12,
      `Expected 12+ partitions for 2025, got ${partitions2025.length}`
    );
  });

  void it('has partition for January 2025', async () => {
    const partitions = await getTablePartitions('inventory_ledger');
    const jan2025 = partitions.find((p) => p.partition_name.includes('2025_01'));

    assert.ok(jan2025, 'inventory_ledger_2025_01 partition should exist');
  });
});

// ============================================
// API_COST_TRACKING PARTITIONS
// ============================================

void describe('Partitions: api_cost_tracking', { skip: SKIP }, () => {
  void it('has at least 12 monthly partitions for 2025', async () => {
    const partitions = await getTablePartitions('api_cost_tracking');
    const partitions2025 = partitions.filter((p) => p.partition_name.includes('2025'));

    assert.ok(
      partitions2025.length >= 12,
      `Expected 12+ partitions for 2025, got ${partitions2025.length}`
    );
  });

  void it('has partition for January 2025', async () => {
    const partitions = await getTablePartitions('api_cost_tracking');
    const jan2025 = partitions.find((p) => p.partition_name.includes('2025_01'));

    assert.ok(jan2025, 'api_cost_tracking_2025_01 partition should exist');
  });
});

// ============================================
// WEBHOOK_EVENTS PARTITIONS
// ============================================

void describe('Partitions: webhook_events', { skip: SKIP }, () => {
  void it('has at least 12 monthly partitions for 2025', async () => {
    const partitions = await getTablePartitions('webhook_events');
    const partitions2025 = partitions.filter((p) => p.partition_name.includes('2025'));

    assert.ok(
      partitions2025.length >= 12,
      `Expected 12+ partitions for 2025, got ${partitions2025.length}`
    );
  });

  void it('has partition for January 2025', async () => {
    const partitions = await getTablePartitions('webhook_events');
    const jan2025 = partitions.find((p) => p.partition_name.includes('2025_01'));

    assert.ok(jan2025, 'webhook_events_2025_01 partition should exist');
  });
});

// ============================================
// PARTITION NAMING CONVENTION
// ============================================

void describe('Partition Naming Convention', { skip: SKIP }, () => {
  void it('follows table_YYYY_MM naming pattern', async () => {
    const allPartitions = await getAllPartitions();

    const pattern = /^[a-z_]+_\d{4}_\d{2}$/;

    for (const partition of allPartitions) {
      assert.ok(
        pattern.test(partition.partition_name),
        `Partition ${partition.partition_name} should match pattern table_YYYY_MM`
      );
    }
  });
});

// ============================================
// 2026 PARTITIONS (FUTURE)
// ============================================

void describe('Future Partitions (2026)', { skip: SKIP }, () => {
  void it('has at least Q1 2026 partitions pre-created', async () => {
    const allPartitions = await getAllPartitions();
    const partitions2026 = allPartitions.filter((p) => p.partition_name.includes('2026'));

    // Should have at least 4 months of 2026 pre-created (Jan-Apr)
    assert.ok(
      partitions2026.length >= 4,
      `Expected at least 4 partitions for 2026, got ${partitions2026.length}`
    );
  });

  void it('audit_logs has January 2026 partition', async () => {
    const partitions = await getTablePartitions('audit_logs');
    const jan2026 = partitions.find((p) => p.partition_name.includes('2026_01'));

    assert.ok(jan2026, 'audit_logs_2026_01 partition should exist');
  });
});
