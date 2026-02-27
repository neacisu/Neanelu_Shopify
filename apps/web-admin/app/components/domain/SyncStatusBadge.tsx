import type { SyncStatus } from '@app/types';
import { InfoTooltip } from '../ui/info-tooltip';

const labelMap: Record<SyncStatus, string> = {
  synced: 'Sincronizat',
  pending: 'În așteptare',
  error: 'Eroare',
  never: 'Niciodată',
};

const styleMap: Record<SyncStatus, string> = {
  synced: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  never: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300',
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
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-transform duration-150 hover:scale-105 ${styleMap[resolved]} ${
          isPending ? 'motion-safe:animate-pulse' : ''
        }`}
      >
        {labelMap[resolved]}
      </span>
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
