import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProductsAddToCollectionModal } from '../components/domain/ProductsAddToCollectionModal';

describe('ProductsAddToCollectionModal', () => {
  it('allows selecting collection and confirming', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ProductsAddToCollectionModal
        open
        collections={[
          { id: 'col-1', title: 'Collection 1', collectionType: 'MANUAL', productsCount: 10 },
        ]}
        onClose={() => undefined}
        onConfirm={onConfirm}
      />
    );

    const addButton = screen.getByRole('button', { name: 'Add to collection' });
    expect(addButton).toBeDisabled();

    await user.click(screen.getByRole('radio'));
    expect(addButton).not.toBeDisabled();

    await user.click(addButton);
    expect(onConfirm).toHaveBeenCalledWith('col-1');
  });
});
