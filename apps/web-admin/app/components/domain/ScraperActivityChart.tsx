import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ScraperActivityDataPoint } from '@app/types';

import { InfoTooltip } from '../ui/info-tooltip';

export function ScraperActivityChart({ data }: { data: readonly ScraperActivityDataPoint[] }) {
  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4 dark:border-slate-700 dark:bg-slate-900/80">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted dark:text-slate-400">Activitate scraper (7 zile)</span>
        <InfoTooltip title="Activitate scraper" side="bottom" portalToBody>
          Număr de pagini procesate pe zi, grupate pe metoda de extragere: Cheerio (HTML rapid) și
          Playwright (JS complet). Include și eșecurile, blocările robots.txt și duplicatele
          eliminate. De exemplu, un vârf de eșecuri poate indica un site indisponibil. Sfat:
          graficul arată tendința pe ultimele 7 zile.
        </InfoTooltip>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="dark:[&>line]:stroke-slate-700" />
            <XAxis
              dataKey="date"
              className="dark:[&>line]:stroke-slate-600 dark:[&_text]:fill-slate-400"
            />
            <YAxis className="dark:[&>line]:stroke-slate-600 dark:[&_text]:fill-slate-400" />
            <Tooltip
              contentStyle={{
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border, #e2e8f0)',
              }}
            />
            <Legend />
            <Area type="monotone" dataKey="cheerio" stackId="1" stroke="#16a34a" fill="#16a34a55" />
            <Area
              type="monotone"
              dataKey="playwright"
              stackId="1"
              stroke="#f59e0b"
              fill="#f59e0b55"
            />
            <Area type="monotone" dataKey="failed" stackId="2" stroke="#dc2626" fill="#dc262655" />
            <Area
              type="monotone"
              dataKey="robotsBlocked"
              stackId="2"
              stroke="#f97316"
              fill="#f9731655"
            />
            <Area type="monotone" dataKey="deduped" stackId="2" stroke="#64748b" fill="#64748b55" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
