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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/10 px-3 py-2 text-sm">
      <div className="mr-auto text-sm font-medium">
        {selectedCount} products selected
        {limitReached ? ' (limit exceeded)' : ''}
      </div>
      <Button size="sm" variant="secondary" onClick={onForceSync} disabled={limitReached}>
        Force Sync
      </Button>
      <Button size="sm" variant="secondary" onClick={onAssignCategory} disabled={limitReached}>
        Assign Category
      </Button>
      <Button size="sm" variant="secondary" onClick={onAddToCollection} disabled={limitReached}>
        Add to Collection
      </Button>
      <Button size="sm" variant="secondary" onClick={onExport} disabled={limitReached}>
        Export
      </Button>
      <Button size="sm" variant="secondary" onClick={onCompare} disabled={selectedCount > 3}>
        Compare
      </Button>
      <Button size="sm" variant="secondary" onClick={onRequestEnrichment} disabled={limitReached}>
        Request Enrichment
      </Button>
    </div>
  );
}
