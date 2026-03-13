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
      className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-md)]"
      role="img"
      aria-label="Grafic costuri zilnice pe categorii: cautare, audit, extractie si embedding."
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted">
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
            { dataKey: 'search', name: 'Cautare', color: 'rgb(var(--chart-2))' },
            { dataKey: 'audit', name: 'AI Audit', color: 'rgb(var(--chart-6))' },
            { dataKey: 'extraction', name: 'Extractie', color: 'rgb(var(--color-success))' },
            { dataKey: 'embedding', name: 'Embedding', color: 'rgb(var(--color-warning))' },
          ]}
        />
      ) : (
        <div className="rounded-md border border-dashed border-muted/30 p-4 text-sm text-muted">
          Nu exista date pentru perioada selectata.
        </div>
      )}
    </div>
  );
}
