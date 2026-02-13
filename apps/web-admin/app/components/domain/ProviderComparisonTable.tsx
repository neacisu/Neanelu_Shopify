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

const usdFormatter = new Intl.NumberFormat('ro-RO', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const formatCost = (value: number) => usdFormatter.format(value);

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
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-3 text-xs text-muted">Comparatie furnizori</div>
      <div className="overflow-x-auto rounded-md border border-muted/20">
        <table className="min-w-[560px] w-full text-sm">
          <caption className="sr-only">
            Comparatie costuri API pe furnizori pentru astazi, saptamana si luna curenta.
          </caption>
          <thead className="bg-muted/30 text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Furnizor
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Astazi
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Saptamana
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Luna
              </th>
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
