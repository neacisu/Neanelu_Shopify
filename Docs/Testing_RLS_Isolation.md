# RLS Isolation Test Cases - NEANELU Shopify Manager

> **Versiune:** 1.0 | **Data:** 2025-12-26

---

## Overview

Acest document definește test cases pentru validarea completă a Row-Level Security (RLS) în contextul multi-tenant. Testele verifică că datele unui shop nu sunt accesibile altui shop.

---

## Test Environment Setup

### Prerequisites

- PostgreSQL 18.1 cu RLS activat
- Minim 2 shop-uri de test create
- User `app_runtime` configurat

### Test Data

```sql
-- Create test shops
INSERT INTO shops (id, shopify_domain, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'shop-alpha.myshopify.com', 'Shop Alpha'),
  ('22222222-2222-2222-2222-222222222222', 'shop-beta.myshopify.com', 'Shop Beta');

-- Create test products for each shop
INSERT INTO shopify_products (id, shop_id, shopify_id, title) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 1001, 'Alpha Product 1'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 1002, 'Alpha Product 2'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 2001, 'Beta Product 1');
```

---

## Test Cases

### TC-RLS-001: Basic Tenant Isolation

**Objective:** Verify that Shop Alpha cannot see Shop Beta's products.

**Steps:**

```sql
-- Set context to Shop Alpha
BEGIN;
SET LOCAL app.current_shop_id = '11111111-1111-1111-1111-111111111111';

-- Query products
SELECT id, title FROM shopify_products;

-- Expected: Only 'Alpha Product 1', 'Alpha Product 2'
-- Must NOT see: 'Beta Product 1'

COMMIT;
```

**Expected Result:** 2 rows returned, only Alpha products.

---

### TC-RLS-002: Cross-Tenant Access Prevention

**Objective:** Verify direct access to another tenant's data fails.

**Steps:**

```sql
BEGIN;
SET LOCAL app.current_shop_id = '11111111-1111-1111-1111-111111111111';

-- Try to access specific Beta product by ID
SELECT * FROM shopify_products 
WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

COMMIT;
```

**Expected Result:** 0 rows returned (not found, not error).

---

### TC-RLS-003: Context Reset Between Requests

**Objective:** Verify context doesn't leak between transactions.

**Steps:**

```sql
-- Transaction 1: Shop Alpha
BEGIN;
SET LOCAL app.current_shop_id = '11111111-1111-1111-1111-111111111111';
SELECT COUNT(*) AS alpha_count FROM shopify_products;
COMMIT;

-- Transaction 2: Shop Beta (new connection)
BEGIN;
SET LOCAL app.current_shop_id = '22222222-2222-2222-2222-222222222222';
SELECT COUNT(*) AS beta_count FROM shopify_products;
COMMIT;

-- Transaction 3: No context (should see nothing or error)
BEGIN;
SELECT COUNT(*) AS no_context_count FROM shopify_products;
COMMIT;
```

**Expected Results:**

- alpha_count = 2
- beta_count = 1
- no_context_count = 0 (fail-safe policy)

---

### TC-RLS-004: UPDATE Isolation

**Objective:** Verify updates only affect own tenant's data.

**Steps:**

```sql
BEGIN;
SET LOCAL app.current_shop_id = '11111111-1111-1111-1111-111111111111';

-- Try to update Beta's product (should affect 0 rows)
UPDATE shopify_products 
SET title = 'HACKED' 
WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- Verify
SELECT title FROM shopify_products WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

ROLLBACK;
```

**Expected Result:** 0 rows updated, product title unchanged.

---

### TC-RLS-005: DELETE Isolation

**Objective:** Verify deletes only affect own tenant's data.

**Steps:**

```sql
BEGIN;
SET LOCAL app.current_shop_id = '11111111-1111-1111-1111-111111111111';

-- Try to delete Beta's product
DELETE FROM shopify_products 
WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- Verify it still exists (check as Beta)
SET LOCAL app.current_shop_id = '22222222-2222-2222-2222-222222222222';
SELECT COUNT(*) FROM shopify_products WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

ROLLBACK;
```

**Expected Result:** 0 rows deleted, product still exists.

---

### TC-RLS-006: INSERT Validation

**Objective:** Verify inserts are associated with current context.

**Steps:**

```sql
BEGIN;
SET LOCAL app.current_shop_id = '11111111-1111-1111-1111-111111111111';

-- Insert new product
INSERT INTO shopify_products (id, shop_id, shopify_id, title)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 1003, 'Alpha Product 3');

-- Try to insert for different shop (should fail or be invisible)
INSERT INTO shopify_products (id, shop_id, shopify_id, title)
VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222', 2002, 'Sneaky Beta Product');

-- Verify current context only sees own products
SELECT COUNT(*) FROM shopify_products;

ROLLBACK;
```

**Expected Result:** Policy should prevent inserting for different shop_id OR make it invisible.

---

### TC-RLS-007: Join Query Isolation

**Objective:** Verify JOINs don't leak data.

**Steps:**

```sql
BEGIN;
SET LOCAL app.current_shop_id = '11111111-1111-1111-1111-111111111111';

-- Query with join to variants
SELECT p.title, v.sku
FROM shopify_products p
LEFT JOIN shopify_variants v ON v.product_id = p.id;

COMMIT;
```

**Expected Result:** Only Alpha's products and their variants appear.

---

### TC-RLS-008: Aggregate Function Isolation

**Objective:** Verify aggregate functions respect RLS.

**Steps:**

```sql
-- Shop Alpha context
BEGIN;
SET LOCAL app.current_shop_id = '11111111-1111-1111-1111-111111111111';
SELECT COUNT(*) AS total, SUM(1) AS sum_test FROM shopify_products;
COMMIT;

-- Shop Beta context
BEGIN;
SET LOCAL app.current_shop_id = '22222222-2222-2222-2222-222222222222';
SELECT COUNT(*) AS total, SUM(1) AS sum_test FROM shopify_products;
COMMIT;
```

**Expected Results:**

- Alpha: COUNT = 2
- Beta: COUNT = 1

---

### TC-RLS-009: Concurrent Access Safety

**Objective:** Verify concurrent transactions maintain isolation.

**Steps (run in parallel):**

```sql
-- Session 1
BEGIN;
SET LOCAL app.current_shop_id = '11111111-1111-1111-1111-111111111111';
SELECT pg_sleep(2);
SELECT * FROM shopify_products;
COMMIT;

-- Session 2 (start during Session 1's sleep)
BEGIN;
SET LOCAL app.current_shop_id = '22222222-2222-2222-2222-222222222222';
SELECT * FROM shopify_products;
COMMIT;
```

**Expected Result:** Each session sees only its own data, no cross-contamination.

---

### TC-RLS-010: Bypass Attempt Prevention

**Objective:** Verify RLS cannot be bypassed.

**Steps:**

```sql
-- Attempt 1: Direct table access without context
BEGIN;
RESET app.current_shop_id;
SELECT * FROM shopify_products;
COMMIT;
-- Expected: 0 rows (fail-safe)

-- Attempt 2: SQL injection in shop_id
BEGIN;
SET LOCAL app.current_shop_id = '11111111-1111-1111-1111-111111111111'' OR ''1''=''1';
-- Expected: Error (malformed UUID)
COMMIT;
```

**Expected Results:** All bypass attempts fail gracefully.

---

## Automation Script

```typescript
// test/integration/rls-isolation.test.ts
import { describe, it, beforeAll, afterAll } from 'node:test';
import assert from 'node:assert';
import { pool, setTenantContext } from '@app/database';

describe('RLS Isolation Tests', () => {
  const shopAlphaId = '11111111-1111-1111-1111-111111111111';
  const shopBetaId = '22222222-2222-2222-2222-222222222222';

  it('TC-RLS-001: Shop Alpha cannot see Shop Beta products', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setTenantContext(client, shopAlphaId);
      
      const result = await client.query('SELECT title FROM shopify_products');
      
      assert.ok(result.rows.every(r => !r.title.includes('Beta')));
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  // ... more tests
});
```

---

## Running Tests

```bash
# Run RLS integration tests
pnpm test:rls

# Run with coverage
pnpm test:rls --coverage

# Run specific test
pnpm test:rls --grep "TC-RLS-001"
```

---

## Audit Log

All RLS policy violations are logged to `audit_logs` table with:

- Attempted operation
- User/shop context
- Target table and record
- Timestamp
- Stack trace (in development)
