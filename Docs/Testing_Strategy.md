# Testing Strategy - Neanelu Shopify Enterprise

> **Stack:** Node.js 24 LTS | Vitest (Frontend) | node:test (Backend)
> **Target Coverage:** Backend 80% | Frontend 70% | Integration 60%
> **Last Updated:** 2025-12-26

---

## 1. Testing Pyramid

```text
         ╱╲          E2E Tests (Playwright)
        ╱  ╲         ~10% | Critical user flows only
       ╱────╲        
      ╱      ╲       Integration Tests (Testcontainers)
     ╱        ╲      ~30% | API + DB + Redis
    ╱──────────╲     
   ╱            ╲    Unit Tests (node:test / Vitest)
  ╱──────────────╲   ~60% | Functions, hooks, utilities
```

---

## 2. Backend Testing (`apps/backend-worker`)

### Backend Test Framework

- **Runner:** Node.js native `node:test` (NOT Jest)
- **Assertions:** `node:assert/strict`
- **Watch Mode:** `node --watch --test`

### Commands

```bash
# Run all tests
pnpm --filter @app/backend-worker test

# Watch mode
pnpm --filter @app/backend-worker test:watch

# Coverage
pnpm --filter @app/backend-worker test:coverage
```

### Unit Test Pattern

```typescript
// src/utils/hmac.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyHmac } from './hmac.js';

describe('HMAC Verification', () => {
  it('should return true for valid signature', () => {
    const result = verifyHmac(payload, secret, signature);
    assert.equal(result, true);
  });
  
  it('should use constant-time comparison', () => {
    // Timing attack protection test
  });
});
```

### Integration Test Pattern (Testcontainers)

```typescript
// src/__tests__/integration/bulk-pipeline.test.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';

describe('Bulk Pipeline Integration', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  
  before(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:18.1').start();
    redisContainer = await new RedisContainer('redis:8.4').start();
  });
  
  after(async () => {
    await pgContainer.stop();
    await redisContainer.stop();
  });
});
```

### Mocking Shopify API

```typescript
// src/__tests__/mocks/shopify.ts
import nock from 'nock';

export function mockShopifyBulkOperation() {
  nock('https://test-shop.myshopify.com')
    .post('/admin/api/2025-10/graphql.json')
    .reply(200, {
      data: {
        bulkOperationRunQuery: {
          bulkOperation: { id: 'gid://shopify/BulkOperation/123' }
        }
      }
    });
}
```

---

## 3. Frontend Testing (`apps/web-admin`)

### Frontend Test Framework

- **Runner:** Vitest (Vite-native)
- **Component Testing:** @testing-library/react
- **Assertions:** Vitest built-in

### Frontend Commands

```bash
# Run all tests
pnpm --filter @app/web-admin test

# Watch mode
pnpm --filter @app/web-admin test:watch

# Coverage
pnpm --filter @app/web-admin test:coverage
```

### Component Test Pattern

```typescript
// app/components/domain/jobs-table.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { JobsTable } from './jobs-table';

describe('JobsTable', () => {
  it('renders empty state when no jobs', () => {
    render(<JobsTable jobs={[]} />);
    expect(screen.getByText(/no jobs/i)).toBeInTheDocument();
  });
});
```

---

## 4. E2E Testing (Playwright)

### Scope

Only critical user flows:

1. OAuth installation flow
2. Dashboard load + KPI display
3. Bulk sync initiation
4. Queue job retry action

### Configuration

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  baseURL: `${process.env.APP_HOST || 'https://manager.neanelu.ro'}/app`,
  use: {
    trace: 'on-first-retry',
  },
});
```

---

## 5. CI Gating Requirements

| Gate | Threshold | Action on Fail |
| ---- | --------- | -------------- |
| Unit Tests | 100% pass | Block merge |
| Integration Tests | 100% pass | Block merge |
| Coverage (Backend) | ≥80% | Warning |
| Coverage (Frontend) | ≥70% | Warning |
| Type Check | 0 errors | Block merge |
| Lint | 0 errors | Block merge |

### GitHub Actions Integration

```yaml
# .github/workflows/ci-pr.yml (excerpt)
- name: Backend Tests
  run: pnpm --filter @app/backend-worker test:coverage
  
- name: Frontend Tests
  run: pnpm --filter @app/web-admin test:coverage
  
- name: Upload Coverage
  uses: codecov/codecov-action@v4
```

---

## 6. Test Data Management

### Fixtures

- Located in `src/__tests__/fixtures/`
- Use deterministic data (no random)
- Shopify mock responses in `fixtures/shopify/`

### Database Seeding

```typescript
// packages/database/src/testing/seed.ts
export async function seedTestData(db: DrizzleClient) {
  await db.insert(shops).values(testShop);
  await db.insert(products).values(testProducts);
}
```

---

## 7. Coverage Reports

- **Format:** lcov + html
- **Location:** `coverage/` in each package
- **CI:** Uploaded to Codecov
- **Exclusions:** `*.test.ts`, `__mocks__/`, `dist/`
