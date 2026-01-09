import type { ReactNode } from 'react';

import { PieChart, type PieChartDatum } from './PieChart.js';

export type DonutChartProps = Readonly<{
  data: readonly PieChartDatum[];
  height?: number;
  showLabels?: boolean;
  showLegend?: boolean;
  innerRadius?: number | string;
  centerLabel?: ReactNode;
  onSliceClick?: (datum: PieChartDatum) => void;
}>;

export function DonutChart({ innerRadius = '55%', ...rest }: DonutChartProps) {
  return <PieChart {...rest} innerRadius={innerRadius} />;
}
