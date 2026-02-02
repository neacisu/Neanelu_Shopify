import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProductsCompareModal } from '../components/domain/ProductsCompareModal';

describe('ProductsCompareModal', () => {
  it('renders compare table', () => {
    render(
      <ProductsCompareModal
        open
        onClose={() => undefined}
        items={[
          {
            id: 'prod-1',
            title: 'Product 1',
            vendor: 'Vendor',
            status: 'ACTIVE',
            productType: 'Seeds',
            featuredImageUrl: null,
            priceRange: null,
            qualityLevel: 'bronze',
            qualityScore: '0.5',
            taxonomyId: null,
            gtin: null,
            mpn: null,
            titleMaster: 'Product 1',
            descriptionShort: null,
          },
        ]}
      />
    );

    expect(screen.getByText('Compare products')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getAllByText('Product 1').length).toBeGreaterThan(0);
  });
});
