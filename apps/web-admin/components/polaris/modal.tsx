import type { PropsWithChildren } from 'react';

export type PolarisModalProps = PropsWithChildren<JSX.IntrinsicElements['polaris-modal']>;

export function PolarisModal({ children, ...props }: PolarisModalProps) {
  return <polaris-modal {...props}>{children}</polaris-modal>;
}
