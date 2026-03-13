import type { DataTableColumn } from '../ui/data-table';
import { DataTable } from '../ui/data-table';
import { InfoTooltip } from '../ui/info-tooltip';

type ProviderCosts = Readonly<{
  serper: number;
  xai: number;
  openai: number;
  scraper: number;
  total: number;
}>;

type ProviderComparisonTableProps = Readonly<{
  today: ProviderCosts;
  thisWeek: ProviderCosts;
  thisMonth: ProviderCosts;
}>;

interface ProviderRow {
  id: string;
  label: string;
  today: number;
  thisWeek: number;
  thisMonth: number;
}

const usdFormatter = new Intl.NumberFormat('ro-RO', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const formatCost = (value: number) => usdFormatter.format(value);

const columns: readonly DataTableColumn<ProviderRow>[] = [
  {
    id: 'label',
    header: 'Furnizor',
    renderCell: (row) => row.label,
  },
  {
    id: 'today',
    header: 'Azi',
    align: 'right',
    renderCell: (row) => formatCost(row.today),
  },
  {
    id: 'thisWeek',
    header: 'Săptămâna',
    align: 'right',
    renderCell: (row) => formatCost(row.thisWeek),
  },
  {
    id: 'thisMonth',
    header: 'Luna',
    align: 'right',
    renderCell: (row) => formatCost(row.thisMonth),
  },
];

export function ProviderComparisonTable({
  today,
  thisWeek,
  thisMonth,
}: ProviderComparisonTableProps) {
  const rows: ProviderRow[] = [
    {
      id: 'serper',
      label: 'Serper',
      today: today.serper,
      thisWeek: thisWeek.serper,
      thisMonth: thisMonth.serper,
    },
    { id: 'xai', label: 'xAI', today: today.xai, thisWeek: thisWeek.xai, thisMonth: thisMonth.xai },
    {
      id: 'openai',
      label: 'OpenAI',
      today: today.openai,
      thisWeek: thisWeek.openai,
      thisMonth: thisMonth.openai,
    },
    {
      id: 'scraper',
      label: 'Scraper',
      today: today.scraper,
      thisWeek: thisWeek.scraper,
      thisMonth: thisMonth.scraper,
    },
    {
      id: 'total',
      label: 'Total',
      today: today.total,
      thisWeek: thisWeek.total,
      thisMonth: thisMonth.total,
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      rowKey={(row) => row.id}
      caption={
        <span className="inline-flex items-center gap-1.5">
          Comparație furnizori
          <InfoTooltip title="Comparație furnizori">
            Tabelul compară costurile API pe fiecare furnizor (Serper, xAI, OpenAI, Scraper). De ce
            contează: identifici rapid care furnizor consumă cel mai mult. Exemplu: dacă OpenAI
            costă mai mult decât Serper, poți evalua eficiența. Sfat: monitorizează totalul lunar
            pentru a rămâne sub buget.
          </InfoTooltip>
        </span>
      }
      tableClassName="min-w-[560px]"
      className="rounded-lg border-muted/20"
    />
  );
}
