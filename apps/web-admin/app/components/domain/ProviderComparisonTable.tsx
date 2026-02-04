type ProviderCosts = Readonly<{
  serper: number;
  xai: number;
  total: number;
}>;

type ProviderComparisonTableProps = Readonly<{
  today: ProviderCosts;
  thisWeek: ProviderCosts;
  thisMonth: ProviderCosts;
}>;

const formatCost = (value: number) => value.toFixed(2);

export function ProviderComparisonTable({
  today,
  thisWeek,
  thisMonth,
}: ProviderComparisonTableProps) {
  const rows = [
    {
      id: 'serper',
      label: 'Serper',
      today: today.serper,
      thisWeek: thisWeek.serper,
      thisMonth: thisMonth.serper,
    },
    {
      id: 'xai',
      label: 'xAI',
      today: today.xai,
      thisWeek: thisWeek.xai,
      thisMonth: thisMonth.xai,
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
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-3 text-xs text-muted">Provider comparison</div>
      <div className="overflow-hidden rounded-md border border-muted/20">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Provider</th>
              <th className="px-3 py-2 text-right font-medium">Today</th>
              <th className="px-3 py-2 text-right font-medium">This week</th>
              <th className="px-3 py-2 text-right font-medium">This month</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-muted/20">
                <td className="px-3 py-2 text-left">{row.label}</td>
                <td className="px-3 py-2 text-right">{formatCost(row.today)}</td>
                <td className="px-3 py-2 text-right">{formatCost(row.thisWeek)}</td>
                <td className="px-3 py-2 text-right">{formatCost(row.thisMonth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
