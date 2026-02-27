import { BarChart } from '../charts/BarChart';
import { InfoTooltip } from '../ui/info-tooltip';

export type CostBreakdownPoint = Readonly<{
  date: string;
  search: number;
  audit: number;
  extraction: number;
  embedding: number;
}>;

export type CostBreakdownChartProps = Readonly<{
  data: readonly CostBreakdownPoint[];
}>;

export function CostBreakdownChart({ data }: CostBreakdownChartProps) {
  const hasData = data.length > 0;
  return (
    <div
      className="rounded-lg border border-muted/20 bg-white/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-md dark:bg-slate-900/80 dark:border-slate-700/60"
      role="img"
      aria-label="Grafic costuri zilnice pe categorii: cautare, audit, extractie si embedding."
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <span>Distribuție zilnică costuri</span>
        <InfoTooltip title="Distribuție costuri">
          Distribuția zilnică arată costurile pe categorii: Căutare (Serper), AI Audit, Extracție și
          Embedding. De ce contează: identifici ce etapă consumă cel mai mult buget. Exemplu: dacă
          AI Audit domină, poți optimiza prompturile. Sfat: compară zilele pentru a detecta anomalii
          de cost.
        </InfoTooltip>
      </div>
      {hasData ? (
        <BarChart
          data={data}
          xAxisKey="date"
          stacked
          bars={[
            { dataKey: 'search', name: 'Cautare', color: '#3b82f6' },
            { dataKey: 'audit', name: 'AI Audit', color: '#8b5cf6' },
            { dataKey: 'extraction', name: 'Extractie', color: '#22c55e' },
            { dataKey: 'embedding', name: 'Embedding', color: '#f97316' },
          ]}
        />
      ) : (
        <div className="rounded-md border border-dashed border-muted/30 p-4 text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
          Nu exista date pentru perioada selectata.
        </div>
      )}
    </div>
  );
}
