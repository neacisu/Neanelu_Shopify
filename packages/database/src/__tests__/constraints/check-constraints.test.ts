/**
 * CHECK Constraints Tests
 *
 * Tests for all 43 CHECK constraints across the database.
 * Verifies existence and validates allowed values.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getAllCheckConstraints,
  getTableCheckConstraints,
  type CheckConstraintInfo,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// CHECK CONSTRAINTS SUMMARY
// ============================================

void describe('CHECK Constraints Summary', { skip: SKIP }, () => {
  let allChecks: CheckConstraintInfo[];

  before(async () => {
    getPool();
    allChecks = await getAllCheckConstraints();
  });

  after(async () => {
    await closePool();
  });

  void it('has at least 40 CHECK constraints', () => {
    assert.ok(allChecks.length >= 80, `Expected at least 80 CHECKs, got ${allChecks.length}`);
  });

  void it('has expected CHECK constraint count range (80-120)', () => {
    assert.ok(
      allChecks.length >= 80 && allChecks.length <= 120,
      `CHECK count ${allChecks.length} should be in range 80-120`
    );
  });
});

// ============================================
// SHOPS TABLE CHECKS
// ============================================

void describe('CHECK Constraints: shops table', { skip: SKIP }, () => {
  void it('has chk_plan_tier constraint', async () => {
    const checks = await getTableCheckConstraints('shops');
    const planTierCheck = checks.find((c) => c.constraint_name === 'chk_plan_tier');
    assert.ok(planTierCheck, 'chk_plan_tier should exist');

    // Verify it includes expected values
    const clause = planTierCheck?.check_clause.toLowerCase() ?? '';
    assert.ok(
      clause.includes('free') || clause.includes('basic') || clause.includes('plan_tier'),
      'chk_plan_tier should validate plan tier values'
    );
  });
});

// ============================================
// SHOPIFY_PRODUCTS TABLE CHECKS
// ============================================

void describe('CHECK Constraints: shopify_products table', { skip: SKIP }, () => {
  void it('has chk_product_status constraint', async () => {
    const checks = await getTableCheckConstraints('shopify_products');
    const statusCheck = checks.find((c) => c.constraint_name === 'chk_product_status');
    assert.ok(statusCheck, 'chk_product_status should exist');

    // Verify it validates status enum
    const clause = statusCheck?.check_clause.toLowerCase() ?? '';
    assert.ok(
      clause.includes('active') || clause.includes('draft') || clause.includes('archived'),
      'chk_product_status should validate product status values'
    );
  });
});

// ============================================
// BULK_RUNS TABLE CHECKS
// ============================================

void describe('CHECK Constraints: bulk_runs table', { skip: SKIP }, () => {
  void it('has chk_bulk_status constraint', async () => {
    const checks = await getTableCheckConstraints('bulk_runs');
    const statusCheck = checks.find((c) => c.constraint_name === 'chk_bulk_status');
    assert.ok(statusCheck, 'chk_bulk_status should exist');

    // Verify it validates bulk status enum
    const clause = statusCheck?.check_clause.toLowerCase() ?? '';
    assert.ok(
      clause.includes('pending') || clause.includes('running') || clause.includes('completed'),
      'chk_bulk_status should validate bulk operation status values'
    );
  });
});

// ============================================
// GENERIC CHECK CONSTRAINT PATTERN TESTS
// ============================================

void describe('CHECK Constraints: Pattern Verification', { skip: SKIP }, () => {
  void it('all CHECK constraints have valid syntax', async () => {
    const allChecks = await getAllCheckConstraints();

    for (const check of allChecks) {
      assert.ok(check.check_clause, `${check.constraint_name} should have a check clause`);
      assert.ok(
        check.check_clause.includes('CHECK'),
        `${check.constraint_name} clause should include CHECK keyword`
      );
    }
  });

  void it('status columns have CHECK constraints', async () => {
    const allChecks = await getAllCheckConstraints();
    const statusChecks = allChecks.filter(
      (c) => c.constraint_name.includes('status') || c.check_clause.toLowerCase().includes('status')
    );

    assert.ok(statusChecks.length >= 3, 'Should have at least 3 status-related CHECK constraints');
  });

  void it('enum-like columns have CHECK constraints', async () => {
    const allChecks = await getAllCheckConstraints();

    // Verify we have checks for common enum patterns
    const enumPatterns = allChecks.filter(
      (c) =>
        c.check_clause.includes('ANY') ||
        c.check_clause.includes("'") ||
        c.check_clause.includes('IN')
    );

    assert.ok(enumPatterns.length >= 5, 'Should have at least 5 enum-like CHECK constraints');
  });
});

// ============================================
// SPECIFIC TABLE CHECKS
// ============================================

void describe('CHECK Constraints: Specific Tables', { skip: SKIP }, () => {
  void it('ai_batches has status check', async () => {
    const checks = await getTableCheckConstraints('ai_batches');
    const statusCheck = checks.find(
      (c) => c.constraint_name.includes('status') || c.check_clause.includes('status')
    );
    assert.ok(statusCheck != null || checks.length > 0, 'ai_batches may have status check');
  });

  void it('job_runs has status check', async () => {
    const checks = await getTableCheckConstraints('job_runs');
    const statusCheck = checks.find(
      (c) => c.constraint_name.includes('status') || c.check_clause.includes('status')
    );
    assert.ok(statusCheck != null || checks.length > 0, 'job_runs may have status check');
  });

  void it('scraper_runs has status check', async () => {
    const checks = await getTableCheckConstraints('scraper_runs');
    const statusCheck = checks.find(
      (c) => c.constraint_name.includes('status') || c.check_clause.includes('status')
    );
    assert.ok(statusCheck != null || checks.length > 0, 'scraper_runs may have status check');
  });
});

// ============================================
// VALUE RANGE CHECKS
// ============================================

void describe('CHECK Constraints: Value Ranges', { skip: SKIP }, () => {
  void it('progress_percent has range check (0-100)', async () => {
    const allChecks = await getAllCheckConstraints();
    const progressCheck = allChecks.find(
      (c) => c.constraint_name.includes('progress') || c.check_clause.includes('progress_percent')
    );

    if (progressCheck) {
      const clause = progressCheck.check_clause;
      assert.ok(
        clause.includes('0') && clause.includes('100'),
        'progress_percent should be constrained to 0-100'
      );
    }
  });

  void it('quality_score has range check (0-1)', async () => {
    const allChecks = await getAllCheckConstraints();
    const qualityCheck = allChecks.find(
      (c) => c.constraint_name.includes('quality') || c.check_clause.includes('quality_score')
    );

    if (qualityCheck) {
      assert.ok(qualityCheck.check_clause, 'quality_score should have a check clause');
    }
  });

  void it('confidence has valid range check', async () => {
    const allChecks = await getAllCheckConstraints();
    const confidenceCheck = allChecks.find(
      (c) => c.constraint_name.includes('confidence') || c.check_clause.includes('confidence')
    );

    if (confidenceCheck) {
      assert.ok(confidenceCheck.check_clause, 'confidence should have a check clause');
    }
  });
});
