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
  const { stroke = 'rgba(0,0,0,0.12)', strokeOpacity = 1, ...rest } = props;
  return <CartesianGrid stroke={stroke} strokeOpacity={strokeOpacity} {...rest} />;
}
