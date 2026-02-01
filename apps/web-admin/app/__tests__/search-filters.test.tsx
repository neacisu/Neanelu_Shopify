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

import { SearchFilters } from '../components/domain/search-filters';

describe('SearchFilters', () => {
  it('renders sections and allows reset', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();

    render(
      <SearchFilters
        filters={{
          vendors: ['Nike'],
          productTypes: [],
          priceMin: null,
          priceMax: null,
          categoryId: null,
        }}
        options={{
          vendors: ['Nike', 'Adidas'],
          productTypes: ['Shoes'],
          priceRange: { min: 10, max: 100 },
          categories: [{ id: 'cat-1', name: 'Footwear' }],
        }}
        onChange={() => undefined}
        onReset={onReset}
      />
    );

    expect(screen.getByText('Advanced filters')).toBeInTheDocument();
    expect(screen.getByText('Vendors (1)')).toBeInTheDocument();
    expect(screen.getByText('Product types')).toBeInTheDocument();
    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getByRole('tree')).toBeInTheDocument();

    await user.click(screen.getByText('Reset all'));
    expect(onReset).toHaveBeenCalled();
  });
});
