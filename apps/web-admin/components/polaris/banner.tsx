import type { PropsWithChildren } from 'react';

export type PolarisBannerProps = PropsWithChildren<JSX.IntrinsicElements['polaris-banner']>;

export function PolarisBanner({ children, ...props }: PolarisBannerProps) {
  return <polaris-banner {...props}>{children}</polaris-banner>;
}
