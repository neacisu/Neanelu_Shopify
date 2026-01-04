import type { PropsWithChildren } from 'react';

export type PolarisCardProps = PropsWithChildren<JSX.IntrinsicElements['polaris-card']>;

export function PolarisCard({ children, ...props }: PolarisCardProps) {
  return <polaris-card {...props}>{children}</polaris-card>;
}
