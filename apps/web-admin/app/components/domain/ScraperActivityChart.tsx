import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';

import type { ScraperActivityDataPoint } from '@app/types';

import { useChartTheme } from '../charts/theme';
import { InfoTooltip } from '../ui/info-tooltip';

export function ScraperActivityChart({ data }: { data: readonly ScraperActivityDataPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const theme = useChartTheme();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setSize({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted">Activitate scraper (7 zile)</span>
        <InfoTooltip title="Activitate scraper" side="bottom" portalToBody>
          Număr de pagini procesate pe zi, grupate pe metoda de extragere: Cheerio (HTML rapid) și
          Playwright (JS complet). Include și eșecurile, blocările robots.txt și duplicatele
          eliminate. De exemplu, un vârf de eșecuri poate indica un site indisponibil. Sfat:
          graficul arată tendința pe ultimele 7 zile.
        </InfoTooltip>
      </div>
      <div ref={containerRef} className="h-64 min-w-0">
        {size != null ? (
          <AreaChart width={size.w} height={size.h} data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={theme.grid}
              className="[&>line]:stroke-border dark:[&>line]:stroke-border"
            />
            <XAxis
              dataKey="date"
              tick={{ fill: theme.text.axis }}
              axisLine={{ stroke: theme.grid }}
              tickLine={false}
              className="[&>line]:stroke-border dark:[&>line]:stroke-border [&_text]:fill-muted dark:[&_text]:fill-muted"
            />
            <YAxis
              tick={{ fill: theme.text.axis }}
              axisLine={false}
              tickLine={false}
              className="[&>line]:stroke-border dark:[&>line]:stroke-border [&_text]:fill-muted dark:[&_text]:fill-muted"
            />
            <Tooltip
              contentStyle={{
                borderRadius: '0.5rem',
                border: `1px solid ${theme.semantic.tooltipBorder}`,
                background: theme.semantic.tooltipBg,
                boxShadow: 'var(--shadow-md)',
              }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="cheerio"
              stackId="1"
              stroke={theme.semantic.success}
              fill={theme.semantic.success}
              fillOpacity={0.33}
            />
            <Area
              type="monotone"
              dataKey="playwright"
              stackId="1"
              stroke={theme.semantic.warning}
              fill={theme.semantic.warning}
              fillOpacity={0.33}
            />
            <Area
              type="monotone"
              dataKey="failed"
              stackId="2"
              stroke={theme.semantic.danger}
              fill={theme.semantic.danger}
              fillOpacity={0.33}
            />
            <Area
              type="monotone"
              dataKey="robotsBlocked"
              stackId="2"
              stroke={theme.palette[3] ?? 'rgb(var(--chart-4))'}
              fill={theme.palette[3] ?? 'rgb(var(--chart-4))'}
              fillOpacity={0.33}
            />
            <Area
              type="monotone"
              dataKey="deduped"
              stackId="2"
              stroke={theme.text.fill}
              fill={theme.text.fill}
              fillOpacity={0.33}
            />
          </AreaChart>
        ) : null}
      </div>
    </div>
  );
}
