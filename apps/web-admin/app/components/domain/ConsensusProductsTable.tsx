import type { ConsensusProductItem } from '@app/types';
import { ConsensusStatusBadge } from './ConsensusStatusBadge';
import { ConflictIndicator } from './ConflictIndicator';

type ConsensusProductsTableProps = Readonly<{
  items: ConsensusProductItem[];
  onSelect?: (item: ConsensusProductItem) => void;
}>;

export function ConsensusProductsTable({ items, onSelect }: ConsensusProductsTableProps) {
  if (items.length === 0) {
    return <div className="text-sm text-muted">No products available.</div>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-muted/20">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Product</th>
            <th className="px-3 py-2 text-right font-medium">Sources</th>
            <th className="px-3 py-2 text-right font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Quality</th>
            <th className="px-3 py-2 text-right font-medium">Conflicts</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.productId}
              className="border-t border-muted/20 hover:bg-muted/10"
              onClick={() => onSelect?.(item)}
            >
              <td className="px-3 py-2">{item.title}</td>
              <td className="px-3 py-2 text-right">{item.sourceCount}</td>
              <td className="px-3 py-2 text-right">
                <ConsensusStatusBadge status={item.consensusStatus} />
              </td>
              <td className="px-3 py-2 text-right">
                {item.qualityScore != null ? item.qualityScore.toFixed(2) : '—'}
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
