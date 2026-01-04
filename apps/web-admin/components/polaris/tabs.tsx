import type { PropsWithChildren } from 'react';

export type PolarisTabsProps = PropsWithChildren<JSX.IntrinsicElements['polaris-tabs']>;

export function PolarisTabs({ children, ...props }: PolarisTabsProps) {
  return <polaris-tabs {...props}>{children}</polaris-tabs>;
}
