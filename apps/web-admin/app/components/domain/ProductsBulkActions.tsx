import { Button } from '../ui/button';

type ProductsBulkActionsProps = Readonly<{
  selectedCount: number;
  onForceSync: () => void;
  onExport: () => void;
  onAssignCategory: () => void;
  onAddToCollection: () => void;
  onCompare: () => void;
  onRequestEnrichment: () => void;
}>;

export function ProductsBulkActions({
  selectedCount,
  onForceSync,
  onExport,
  onAssignCategory,
  onAddToCollection,
  onCompare,
  onRequestEnrichment,
}: ProductsBulkActionsProps) {
  if (selectedCount === 0) return null;
  const limitReached = selectedCount > 100;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/10 px-3 py-2 text-sm transition-shadow duration-200 hover:shadow-[var(--shadow-sm)]">
      <div className="mr-auto text-sm font-medium">
        {selectedCount} produse selectate
        {limitReached ? ' (limită depășită)' : ''}
      </div>
      <Button size="sm" variant="secondary" onClick={onForceSync} disabled={limitReached}>
        Forțare sync
      </Button>
      <Button size="sm" variant="secondary" onClick={onAssignCategory} disabled={limitReached}>
        Atribuie categorie
      </Button>
      <Button size="sm" variant="secondary" onClick={onAddToCollection} disabled={limitReached}>
        Adaugă la colecție
      </Button>
      <Button size="sm" variant="secondary" onClick={onExport} disabled={limitReached}>
        Export
      </Button>
      <Button size="sm" variant="secondary" onClick={onCompare} disabled={selectedCount > 3}>
        Compară
      </Button>
      <Button size="sm" variant="secondary" onClick={onRequestEnrichment} disabled={limitReached}>
        Cere îmbogățire
      </Button>
    </div>
  );
}
