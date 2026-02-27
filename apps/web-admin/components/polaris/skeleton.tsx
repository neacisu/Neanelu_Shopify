import type { ComponentPropsWithoutRef } from 'react';

export type PolarisSkeletonProps = ComponentPropsWithoutRef<'div'> & {
  variant?: 'text' | 'rect' | 'circle';
};

export function PolarisSkeleton({
  className = '',
  variant = 'rect',
  ...props
}: PolarisSkeletonProps) {
  const variantClass =
    variant === 'circle' ? 'rounded-full' : variant === 'text' ? 'rounded-md h-4' : 'rounded-lg';

  return (
    <div
      className={`
        overflow-hidden bg-slate-200/60
        dark:bg-slate-700/40
        ${variantClass}
        ${className}
      `}
      aria-hidden
      {...props}
    >
      <div className="h-full w-full animate-[shimmer-loading_1.5s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent bg-[length:200%_100%] dark:via-white/5" />
    </div>
  );
}
