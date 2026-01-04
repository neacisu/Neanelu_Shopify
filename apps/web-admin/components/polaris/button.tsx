import type { PropsWithChildren } from 'react';

export type PolarisButtonProps = PropsWithChildren<
  JSX.IntrinsicElements['polaris-button'] & {
    variant?: 'primary' | 'secondary' | 'tertiary' | 'plain' | 'critical';
    disabled?: boolean;
    loading?: boolean;
  }
>;

export function PolarisButton({ children, ...props }: PolarisButtonProps) {
  return <polaris-button {...props}>{children}</polaris-button>;
}
