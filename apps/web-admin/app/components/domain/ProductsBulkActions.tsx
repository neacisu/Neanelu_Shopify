import { Check } from 'lucide-react';

import { useButtonState } from '../../hooks/use-button-state.js';
import { Button } from '../ui/button.js';

type ProductsBulkActionsProps = Readonly<{
  selectedCount: number;
  onForceSync: () => Promise<void> | void;
  onExport: () => void;
  onAssignCategory: () => void;
  onAddToCollection: () => void;
  onCompare: () => void;
  onRequestEnrichment: () => Promise<void> | void;
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

  const syncState = useButtonState({ feedbackMs: 1500 });
  const enrichState = useButtonState({ feedbackMs: 1500 });

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/10 px-3 py-2 text-sm transition-shadow duration-200 hover:shadow-[var(--shadow-sm)]"
      aria-label="Acțiuni bulk produse selectate"
    >
      <div className="mr-auto text-sm font-medium">
        {selectedCount} produse selectate
        {limitReached ? ' (limită depășită)' : ''}
      </div>

      <Button
        size="sm"
        variant="secondary"
        loading={syncState.isLoading}
        disabled={limitReached || syncState.isLoading}
        onClick={() => {
          void syncState.run(async () => {
            await onForceSync();
          });
        }}
      >
        {syncState.isSuccess ? (
          <span className="inline-flex items-center gap-1 motion-safe:animate-[fadeSlideUp_0.2s_ease-out]">
            <Check className="size-3.5 text-success" aria-hidden />
            Pornit
          </span>
        ) : (
          'Forțare sync'
        )}
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

      <Button
        size="sm"
        variant="secondary"
        loading={enrichState.isLoading}
        disabled={limitReached || enrichState.isLoading}
        onClick={() => {
          void enrichState.run(async () => {
            await onRequestEnrichment();
          });
        }}
      >
        {enrichState.isSuccess ? (
          <span className="inline-flex items-center gap-1 motion-safe:animate-[fadeSlideUp_0.2s_ease-out]">
            <Check className="size-3.5 text-success" aria-hidden />
            Solicitat
          </span>
        ) : (
          'Cere îmbogățire'
        )}
      </Button>
    </div>
  );
}
