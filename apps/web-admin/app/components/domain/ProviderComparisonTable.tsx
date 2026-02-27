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
    <div className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-md dark:bg-slate-900/80 dark:border-slate-700/60">
      <div className="mb-3 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <span>Comparație furnizori</span>
        <InfoTooltip title="Comparație furnizori">
          Tabelul compară costurile API pe fiecare furnizor (Serper, xAI, OpenAI, Scraper). De ce
          contează: identifici rapid care furnizor consumă cel mai mult. Exemplu: dacă OpenAI costă
          mai mult decât Serper, poți evalua eficiența. Sfat: monitorizează totalul lunar pentru a
          rămâne sub buget.
        </InfoTooltip>
      </div>
      <div className="overflow-x-auto rounded-md border border-muted/20 dark:border-slate-700">
        <table className="min-w-[560px] w-full text-sm">
          <caption className="sr-only">
            Comparatie costuri API pe furnizori pentru astazi, saptamana si luna curenta.
          </caption>
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Furnizor
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Azi
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Săptămâna
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Luna
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-t border-muted/20 dark:border-slate-700 text-slate-800 dark:text-slate-200"
              >
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
