import type { ComponentPropsWithoutRef } from 'react';

export type ProgressVariant = 'default' | 'success' | 'warning' | 'error' | 'info';
export type ProgressSize = 'sm' | 'md' | 'lg';
export type ProgressSegment = Readonly<{
  value: number;
  variant?: ProgressVariant;
}>;

export type ProgressBarProps = ComponentPropsWithoutRef<'div'> & {
  progress?: number;
  variant?: ProgressVariant;
  size?: ProgressSize;
  indeterminate?: boolean;
  segments?: readonly ProgressSegment[];
};

const sizeClass: Record<ProgressSize, string> = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-3',
};

const variantClass: Record<ProgressVariant, string> = {
  default: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  info: 'bg-info',
};

function clamp(value: number) {
  return Math.min(Math.max(Number(value) || 0, 0), 100);
}

function joinClasses(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export function ProgressBar({
  progress = 0,
  variant = 'default',
  size = 'md',
  indeterminate = false,
  segments,
  className,
  ...rest
}: ProgressBarProps) {
  const pct = clamp(progress);
  const normalizedSegments = (segments ?? []).map((segment) => ({
    ...segment,
    value: clamp(segment.value),
  }));

  return (
    <div
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : pct}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-busy={indeterminate || undefined}
      className={joinClasses(
        'w-full overflow-hidden rounded-full bg-subtle shadow-[inset_0_1px_2px_rgb(var(--color-foreground)/0.08)]',
        sizeClass[size],
        className
      )}
      {...rest}
    >
      {normalizedSegments.length > 0 ? (
        <div className="flex h-full w-full overflow-hidden rounded-full">
          {normalizedSegments.map((segment, index) => (
            <div
              key={`${segment.variant ?? variant}-${index}`}
              className={joinClasses(
                'h-full transition-[width,background-color] duration-500 ease-out-enterprise',
                variantClass[segment.variant ?? variant]
              )}
              style={{ width: `${segment.value}%` }}
            />
          ))}
        </div>
      ) : indeterminate ? (
        <div className="relative h-full w-full overflow-hidden rounded-full">
          <div className="absolute inset-y-0 left-0 w-2/5 animate-[slide-right_1.2s_linear_infinite] rounded-full bg-primary/80" />
        </div>
      ) : (
        <div
          className={joinClasses(
            'h-full rounded-full transition-[width,background-color] duration-500 ease-out-enterprise',
            variantClass[variant]
          )}
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}
