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

export function ScraperActivityChart({ data }: { data: readonly ScraperActivityDataPoint[] }) {
  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-2 text-xs text-muted">Scraper activity (7 zile)</div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
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
