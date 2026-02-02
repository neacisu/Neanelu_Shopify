import { useMemo, useState } from 'react';
import { PolarisModal } from '../../../components/polaris/index.js';
import type { ProductFiltersResponse } from '@app/types';

import { TreeView, type TreeNode } from '../ui/TreeView';
import { Button } from '../ui/button';

type ProductsAssignCategoryModalProps = Readonly<{
  open: boolean;
  categories: ProductFiltersResponse['categories'];
  onClose: () => void;
  onConfirm: (categoryId: string) => void | Promise<void>;
}>;

function toTree(nodes: ProductFiltersResponse['categories']): TreeNode[] {
  return nodes.map((node) => {
    const children = node.children?.length ? toTree(node.children) : undefined;
    return children
      ? { id: node.id, label: node.name, children }
      : { id: node.id, label: node.name };
  });
}

export function ProductsAssignCategoryModal({
  open,
  categories,
  onClose,
  onConfirm,
}: ProductsAssignCategoryModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tree = useMemo(() => toTree(categories), [categories]);

  return (
    <PolarisModal open={open} onClose={onClose}>
      <div className="space-y-4 p-4">
        <div>
          <div className="text-h3">Assign category</div>
          <p className="text-body text-muted">Choose a taxonomy category for selected products.</p>
        </div>

        <div className="rounded-md border bg-background p-2">
          <TreeView
            nodes={tree}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            ariaLabel="Category tree"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => selectedId && void onConfirm(selectedId)}
            disabled={!selectedId}
          >
            Assign
          </Button>
        </div>
      </div>
    </PolarisModal>
  );
}
