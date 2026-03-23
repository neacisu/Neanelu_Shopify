import type { ConsensusProductItem } from '@app/types';

import type { DataTableColumn } from '../ui/data-table';
import { DataTable } from '../ui/data-table';
import { ConsensusStatusBadge } from './ConsensusStatusBadge';
import { ConflictIndicator } from './ConflictIndicator';

type ConsensusProductsTableProps = Readonly<{
  items: ConsensusProductItem[];
  onSelect?: (item: ConsensusProductItem) => void;
}>;

const columns: readonly DataTableColumn<ConsensusProductItem>[] = [
  {
    id: 'title',
    header: 'Produs',
    renderCell: (row) => <span className="max-w-50 truncate block">{row.title}</span>,
  },
  {
    id: 'sourceCount',
    header: 'Surse',
    align: 'right',
    renderCell: (row) => row.sourceCount,
  },
  {
    id: 'consensusStatus',
    header: 'Status',
    align: 'right',
    renderCell: (row) => <ConsensusStatusBadge status={row.consensusStatus} />,
  },
  {
    id: 'qualityScore',
    header: 'Calitate',
    align: 'right',
    renderCell: (row) => (row.qualityScore != null ? Number(row.qualityScore).toFixed(2) : '—'),
  },
  {
    id: 'conflictsCount',
    header: 'Conflicte',
    align: 'right',
    renderCell: (row) => <ConflictIndicator count={row.conflictsCount} />,
  },
];

export function ConsensusProductsTable({ items, onSelect }: ConsensusProductsTableProps) {
  const extraProps = onSelect ? { onRowClick: onSelect } : {};
  return (
    <DataTable
      data={items}
      columns={columns}
      rowKey={(row) => row.productId}
      {...extraProps}
      emptyState={
        <div className="py-6 text-center text-sm text-muted">Nu există produse disponibile.</div>
      }
      className="rounded-md border-muted/20"
    />
  );
}
