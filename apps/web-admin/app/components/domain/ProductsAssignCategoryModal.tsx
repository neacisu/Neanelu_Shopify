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
      <div className="space-y-4 p-4 bg-white/80 backdrop-blur-sm dark:bg-slate-900/80 rounded-lg">
        <div>
          <div className="text-h3 dark:text-slate-100">Atribuie categorie</div>
          <p className="text-body text-muted dark:text-slate-400">
            Alege o categorie din taxonomie pentru produsele selectate.
          </p>
        </div>

        <div className="rounded-md border border-border dark:border-slate-700 bg-white dark:bg-slate-800 p-2">
          <TreeView
            nodes={tree}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            ariaLabel="Arbore categorii"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Anulare
          </Button>
          <Button
            variant="secondary"
            onClick={() => selectedId && void onConfirm(selectedId)}
            disabled={!selectedId}
          >
            Atribuie
          </Button>
        </div>
      </div>
    </PolarisModal>
  );
}
