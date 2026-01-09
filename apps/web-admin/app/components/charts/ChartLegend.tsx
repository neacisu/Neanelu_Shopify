import type { ComponentProps } from 'react';

import { Legend } from 'recharts';

export type ChartLegendProps = ComponentProps<typeof Legend>;

export function ChartLegend(props: ChartLegendProps) {
  return (
    <Legend
      wrapperStyle={{
        fontSize: 12,
        lineHeight: '16px',
        ...(props.wrapperStyle ?? {}),
      }}
      {...props}
    />
  );
}
