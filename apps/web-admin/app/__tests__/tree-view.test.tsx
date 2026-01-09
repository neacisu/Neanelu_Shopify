import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TreeView, type TreeNode } from '../components/ui/TreeView';

describe('TreeView', () => {
  const nodes: TreeNode[] = [
    {
      id: 'root',
      label: 'Root',
      children: [
        { id: 'child-1', label: 'Child 1' },
        { id: 'child-2', label: 'Child 2' },
      ],
    },
  ];

  it('expands and selects nodes', async () => {
    const user = userEvent.setup();

    render(<TreeView nodes={nodes} />);

    // Expand
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByRole('button', { name: 'Child 1' })).toBeInTheDocument();

    // Select
    await user.click(screen.getByRole('button', { name: 'Child 1' }));
    const items = screen.getAllByRole('treeitem');
    expect(items.some((i) => i.getAttribute('aria-selected') === 'true')).toBe(true);
  });

  it('supports multi-select (ctrl/meta toggle)', async () => {
    const user = userEvent.setup();

    render(<TreeView nodes={nodes} multiSelect />);

    await user.click(screen.getByRole('button', { name: 'Expand' }));

    await user.click(screen.getByRole('button', { name: 'Child 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Child 2' }), { ctrlKey: true });

    const selected = screen
      .getAllByRole('treeitem')
      .filter((i) => i.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(2);
  });

  it('lazy-loads children when expanding a node', async () => {
    const user = userEvent.setup();

    const loadChildren = () => Promise.resolve([{ id: 'lazy-1', label: 'Lazy 1' }] as const);

    render(
      <TreeView
        nodes={[{ id: 'root', label: 'Root', hasChildren: true }]}
        loadChildren={loadChildren}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(await screen.findByRole('button', { name: 'Lazy 1' })).toBeInTheDocument();
  });
});
