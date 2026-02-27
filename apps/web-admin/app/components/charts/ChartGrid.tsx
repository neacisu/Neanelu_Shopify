import type { ComponentProps } from 'react';

import { CartesianGrid } from 'recharts';

export type ChartGridProps = Omit<
  ComponentProps<typeof CartesianGrid>,
  'stroke' | 'strokeOpacity'
> & {
  stroke?: string;
  strokeOpacity?: number;
};

export function ChartGrid(props: ChartGridProps) {
  const { stroke, strokeOpacity = 0.4, ...rest } = props;
  const resolvedStroke = stroke ?? 'var(--chart-grid-color, rgba(100,116,139,0.25))';
  return <CartesianGrid stroke={resolvedStroke} strokeOpacity={strokeOpacity} {...rest} />;
}
