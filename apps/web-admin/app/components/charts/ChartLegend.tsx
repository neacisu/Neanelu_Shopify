import type { ComponentProps, MouseEvent } from 'react';

import { Legend } from 'recharts';
import type { LegendPayload } from 'recharts';

export type ChartLegendProps = ComponentProps<typeof Legend> & {
  /** Callback la click pe item – permite toggle serie (ascundere/afișare). */
  onToggle?: (dataKey: string, inactive: boolean) => void;
  /** Formatter pentru etichete – ex. traducere în română. */
  formatter?: (value: string, entry: LegendPayload, index: number) => React.ReactNode;
};

/** Mapare chei comune → română (folosită implicit când formatter nu e setat). */
const defaultLabelMap: Record<string, string> = {
  value: 'Valoare',
  count: 'Număr',
  total: 'Total',
  name: 'Nume',
  date: 'Dată',
  amount: 'Sumă',
  quantity: 'Cantitate',
};

function defaultFormatter(value: string, _entry: LegendPayload, _index: number): React.ReactNode {
  return defaultLabelMap[value] ?? value;
}

export function ChartLegend({
  onToggle,
  formatter,
  wrapperStyle,
  inactiveColor = 'var(--color-muted, #94a3b8)',
  onClick: onClickProp,
  ...props
}: ChartLegendProps) {
  const handleClick =
    onToggle &&
    ((data: LegendPayload, _index: number, event: MouseEvent) => {
      event.stopPropagation();
      const key = String(data.dataKey ?? data.value ?? '');
      if (key) onToggle(key, !data.inactive);
    });

  const resolvedFormatter = formatter ?? defaultFormatter;
  const resolvedOnClick = handleClick ?? onClickProp;

  return (
    <Legend
      {...props}
      wrapperStyle={{
        fontSize: 12,
        lineHeight: '16px',
        cursor: resolvedOnClick ? 'pointer' : 'default',
        ...(wrapperStyle ?? {}),
      }}
      inactiveColor={inactiveColor}
      formatter={(value: string, entry: LegendPayload, index: number) => {
        const label = resolvedFormatter(value, entry, index);
        const isInactive = entry.inactive;
        return (
          <span
            style={{
              opacity: isInactive ? 0.4 : 1,
              transition: 'opacity 0.2s ease-out',
              textDecoration: isInactive ? 'line-through' : 'none',
            }}
          >
            {label}
          </span>
        );
      }}
      {...(resolvedOnClick ? { onClick: resolvedOnClick } : {})}
    />
  );
}
