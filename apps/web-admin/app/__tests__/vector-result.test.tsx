import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { VectorResultCard } from '../components/domain/vector-result';

describe('VectorResultCard', () => {
  it('renders title, vendor, price and score', () => {
    render(
      <VectorResultCard
        result={{
          id: 'prod-1',
          title: 'Sample Product',
          similarity: 0.92,
          vendor: 'Nike',
          productType: 'Shoes',
          priceRange: { min: '10', max: '20', currency: 'RON' },
        }}
        onClick={() => undefined}
      />
    );

    expect(screen.getByText('Sample Product')).toBeInTheDocument();
    expect(screen.getByText('Nike')).toBeInTheDocument();
    expect(screen.getByText('0.92')).toBeInTheDocument();
    expect(screen.getByText(/RON/)).toBeInTheDocument();
  });

  it('fires onClick when card is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <VectorResultCard
        result={{
          id: 'prod-2',
          title: 'Another Product',
          similarity: 0.7,
        }}
        onClick={onClick}
      />
    );

    await user.click(screen.getByText('Another Product'));
    expect(onClick).toHaveBeenCalled();
  });
});
