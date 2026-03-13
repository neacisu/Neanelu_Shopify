import type { SyncStatus } from '@app/types';

import { Badge } from '../ui/badge.js';
import { InfoTooltip } from '../ui/info-tooltip.js';

const labelMap: Record<SyncStatus, string> = {
  synced: 'Sincronizat',
  pending: 'În așteptare',
  error: 'Eroare',
  never: 'Niciodată',
};

const toneMap: Record<SyncStatus, 'success' | 'warning' | 'critical' | 'neutral'> = {
  synced: 'success',
  pending: 'warning',
  error: 'critical',
  never: 'neutral',
};

type SyncStatusBadgeProps = Readonly<{
  status: SyncStatus | null | undefined;
  lastSyncedAt?: string | null;
  errorMessage?: string | null;
}>;

export function SyncStatusBadge({ status, lastSyncedAt, errorMessage }: SyncStatusBadgeProps) {
  const resolved: SyncStatus = status ?? 'never';
  const isPending = resolved === 'pending';

  const contextInfo = (() => {
    if (resolved === 'synced' && lastSyncedAt) return ` Ultima sincronizare: ${lastSyncedAt}.`;
    if (resolved === 'error' && errorMessage) return ` Detalii eroare: ${errorMessage}.`;
    return '';
  })();

  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={toneMap[resolved]} className={isPending ? 'motion-safe:animate-pulse' : ''}>
        {labelMap[resolved]}
      </Badge>
      <InfoTooltip title="Status sincronizare Shopify">
        Acest indicator arată starea sincronizării produsului cu magazinul Shopify. „Sincronizat"
        înseamnă că datele sunt la zi în Shopify — poți verifica direct în Shopify Admin. „În
        așteptare" (pulsează) înseamnă că modificările vor fi trimise în curând. „Eroare" înseamnă
        că a apărut o problemă la sincronizare — verifică conexiunea și permisiunile. „Niciodată"
        înseamnă că produsul nu a fost încă sincronizat cu Shopify.
        {contextInfo}
        Sfat: pentru produse cu eroare, poți încerca sincronizarea manuală din detaliile produsului.
      </InfoTooltip>
    </span>
  );
}
