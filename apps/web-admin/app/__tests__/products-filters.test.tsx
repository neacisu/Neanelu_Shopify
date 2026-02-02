import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/ui/TreeView', () => ({
  TreeView: ({ nodes }: { nodes?: { id: string; label: string }[] }) => (
    <div role="tree">
      {nodes?.map((node) => (
        <div key={node.id}>{node.label}</div>
      ))}
    </div>
  ),
}));

import { ProductsFilters } from '../components/domain/ProductsFilters';

describe('ProductsFilters', () => {
  it('renders filters and allows reset', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();

    render(
      <ProductsFilters
        filters={{
          vendors: ['Vendor'],
          status: 'ACTIVE',
          qualityLevels: ['bronze'],
          syncStatus: 'synced',
          categoryId: null,
          hasGtin: true,
          enrichmentStatus: ['pending'],
        }}
        options={{
          vendors: ['Vendor'],
          productTypes: [],
          priceRange: { min: null, max: null },
          categories: [{ id: 'cat-1', name: 'Seeds' }],
          enrichmentStatus: ['pending', 'complete'],
        }}
        onChange={() => undefined}
        onReset={onReset}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(onReset).toHaveBeenCalled();
  });
});
