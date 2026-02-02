import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ProductsTable } from '../components/domain/ProductsTable';

function buildProducts(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `prod-${index}`,
    title: `Product ${index}`,
    vendor: index % 2 === 0 ? 'Vendor A' : 'Vendor B',
    status: 'active',
    productType: 'default',
    featuredImageUrl: null,
    categoryId: null,
    syncedAt: null,
    updatedAtShopify: null,
    variantsCount: 1,
    syncStatus: null,
    qualityLevel: null,
    qualityScore: null,
  }));
}

describe('ProductsTable performance', () => {
  it('renders 10k products with virtualization active', () => {
    const products = buildProducts(10_000);
    const start = performance.now();

    render(
      <ProductsTable
        items={products}
        selectedIds={new Set()}
        onToggle={() => undefined}
        onToggleAll={() => undefined}
        onRowClick={() => undefined}
        height={640}
        sortBy="updated_at"
        sortOrder="desc"
        onSortChange={() => undefined}
      />
    );

    const durationMs = performance.now() - start;

    // Sanity: render should not explode in jsdom
    expect(durationMs).toBeLessThan(1000);

    // Virtualization should render only a limited number of rows
    const visibleRows = screen.getAllByRole('row');
    expect(visibleRows.length).toBeLessThan(100);
  });
});
