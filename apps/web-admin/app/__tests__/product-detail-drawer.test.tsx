import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ProductDetailDrawer } from '../components/domain/ProductDetailDrawer';

vi.mock('../hooks/use-api', () => ({
  useApiClient: () => ({
    getApi: () => Promise.resolve({ variants: [], matches: [], events: [], results: [] }),
  }),
}));

describe('ProductDetailDrawer', () => {
  it('renders product details when open', () => {
    render(
      <MemoryRouter>
        <ProductDetailDrawer
          open
          product={{
            id: 'prod-1',
            title: 'Product 1',
            handle: 'product-1',
            description: null,
            descriptionHtml: null,
            vendor: 'Vendor',
            status: 'ACTIVE',
            productType: null,
            tags: [],
            featuredImageUrl: null,
            priceRange: null,
            metafields: {},
            categoryId: null,
            syncedAt: null,
            createdAtShopify: null,
            updatedAtShopify: null,
            pim: null,
            variants: [],
          }}
          onClose={() => undefined}
          onForceSync={() => undefined}
          onEdit={() => undefined}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Product 1')).toBeInTheDocument();
  });
});
