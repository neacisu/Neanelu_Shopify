import type { PropsWithChildren } from 'react';

export type PolarisBadgeProps = PropsWithChildren<
  JSX.IntrinsicElements['polaris-badge'] & {
    tone?: 'success' | 'warning' | 'critical' | 'info' | 'new' | 'neutral';
  }
>;

export function PolarisBadge({ children, ...props }: PolarisBadgeProps) {
  return <polaris-badge {...props}>{children}</polaris-badge>;
}
