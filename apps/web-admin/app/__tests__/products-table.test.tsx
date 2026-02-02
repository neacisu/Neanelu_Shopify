import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/ui/VirtualizedList', () => ({
  VirtualizedList: ({
    items,
    renderItem,
  }: {
    items: unknown[];
    renderItem: (item: unknown) => ReactNode;
  }) => (
    <div>
      {items.map((item, index) => (
        <div key={index}>{renderItem(item)}</div>
      ))}
    </div>
  ),
}));

import { ProductsTable } from '../components/domain/ProductsTable';

describe('ProductsTable', () => {
  it('renders rows and toggles selection', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onToggleAll = vi.fn();
    const onRowClick = vi.fn();

    render(
      <ProductsTable
        items={[
          {
            id: 'prod-1',
            title: 'Product 1',
            vendor: 'Vendor',
            status: 'ACTIVE',
            productType: 'Seeds',
            featuredImageUrl: null,
            categoryId: null,
            syncedAt: null,
            updatedAtShopify: null,
            variantsCount: 1,
            syncStatus: 'synced',
            qualityLevel: 'bronze',
            qualityScore: 0.5,
          },
        ]}
        selectedIds={new Set()}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
        onRowClick={onRowClick}
        height={400}
        sortBy="title"
        sortOrder="asc"
        onSortChange={() => undefined}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    const productCheckbox = checkboxes[1];
    if (!productCheckbox) throw new Error('Product checkbox not found');
    await user.click(productCheckbox);
    expect(onToggle).toHaveBeenCalledWith('prod-1');
  });
});
