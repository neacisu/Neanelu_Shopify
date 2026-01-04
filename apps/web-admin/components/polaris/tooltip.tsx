import type { PropsWithChildren } from 'react';

export type PolarisTooltipProps = PropsWithChildren<JSX.IntrinsicElements['polaris-tooltip']>;

export function PolarisTooltip({ children, ...props }: PolarisTooltipProps) {
  return <polaris-tooltip {...props}>{children}</polaris-tooltip>;
}
