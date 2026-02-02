import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/ui/TreeView', () => ({
  TreeView: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('cat-1')}>
      Select category
    </button>
  ),
}));

import { ProductsAssignCategoryModal } from '../components/domain/ProductsAssignCategoryModal';

describe('ProductsAssignCategoryModal', () => {
  it('allows selecting category and confirming', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ProductsAssignCategoryModal
        open
        categories={[{ id: 'cat-1', name: 'Seeds' }]}
        onClose={() => undefined}
        onConfirm={onConfirm}
      />
    );

    const assignButton = screen.getByRole('button', { name: 'Assign' });
    expect(assignButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Select category' }));
    expect(assignButton).not.toBeDisabled();

    await user.click(assignButton);
    expect(onConfirm).toHaveBeenCalledWith('cat-1');
  });
});
