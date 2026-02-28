import type { ConsensusProductItem } from '@app/types';
import { ConsensusStatusBadge } from './ConsensusStatusBadge';
import { ConflictIndicator } from './ConflictIndicator';

type ConsensusProductsTableProps = Readonly<{
  items: ConsensusProductItem[];
  onSelect?: (item: ConsensusProductItem) => void;
}>;

export function ConsensusProductsTable({ items, onSelect }: ConsensusProductsTableProps) {
  if (items.length === 0) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400">
        Nu există produse disponibile.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-muted/20 dark:border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Produs</th>
            <th className="px-3 py-2 text-right font-medium">Surse</th>
            <th className="px-3 py-2 text-right font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Calitate</th>
            <th className="px-3 py-2 text-right font-medium">Conflicte</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr
              key={item.productId}
              className="cursor-pointer border-t border-muted/20 transition-colors hover:bg-muted/10 dark:border-slate-700 dark:hover:bg-slate-800/50 text-slate-800 dark:text-slate-200"
              style={{ animation: `fadeSlideUp 0.3s ease-out ${idx * 50}ms both` }}
              onClick={() => onSelect?.(item)}
            >
              <td className="px-3 py-2">{item.title}</td>
              <td className="px-3 py-2 text-right">{item.sourceCount}</td>
              <td className="px-3 py-2 text-right">
                <ConsensusStatusBadge status={item.consensusStatus} />
              </td>
              <td className="px-3 py-2 text-right">
                {item.qualityScore != null ? Number(item.qualityScore).toFixed(2) : '—'}
              </td>
              <td className="px-3 py-2 text-right">
                <ConflictIndicator count={item.conflictsCount} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
