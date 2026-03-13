import type { ComponentProps, ReactNode } from 'react';

import { Tooltip } from 'recharts';

type SimplePayloadItem = Readonly<{
  name?: ReactNode;
  value?: unknown;
  color?: string;
  dataKey?: string;
}>;

export type ChartTooltipContentProps = Readonly<{
  active?: boolean;
  label?: ReactNode;
  payload?: readonly SimplePayloadItem[];
}>;

function toSafeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function toLegendLabel(value: ReactNode | undefined, fallback: string | undefined): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return fallback ?? '';
}

function formatNumber(value: unknown): string {
  const text = toSafeText(value);
  const n = Number(text);
  if (!Number.isFinite(n)) return text;
  return new Intl.NumberFormat('ro-RO').format(n);
}

export function ChartTooltipContent(props: ChartTooltipContentProps) {
  const { active, label, payload } = props;
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-card/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur-sm">
      {label !== undefined ? (
        <div className="mb-1.5 font-semibold text-foreground">{label}</div>
      ) : null}
      <div className="space-y-1">
        {payload.map((p, index) => (
          <div
            key={p.dataKey ? String(p.dataKey) : `item-${index}`}
            className="flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: p.color ?? 'currentColor' }}
              />
              <span className="text-muted">{toLegendLabel(p.name, p.dataKey)}</span>
            </div>
            <span className="font-mono font-medium tabular-nums text-foreground">
              {formatNumber(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type ChartTooltipProps = Omit<ComponentProps<typeof Tooltip>, 'content'> & {
  content?: ComponentProps<typeof Tooltip>['content'];
};

export function ChartTooltip(props: ChartTooltipProps) {
  const { content, ...rest } = props;
  const defaultContent: NonNullable<ComponentProps<typeof Tooltip>['content']> = (p) => (
    <ChartTooltipContent {...(p as ChartTooltipContentProps)} />
  );
  return <Tooltip content={content ?? defaultContent} {...rest} />;
}
