import type { PropsWithChildren } from 'react';

export type PolarisToastProps = PropsWithChildren<JSX.IntrinsicElements['polaris-toast']>;

export function PolarisToast({ children, ...props }: PolarisToastProps) {
  return <polaris-toast {...props}>{children}</polaris-toast>;
}
