import type { ComponentPropsWithoutRef, PropsWithChildren } from 'react';

const TONE_CLASSES: Record<
  'success' | 'warning' | 'critical' | 'info' | 'new' | 'neutral',
  string
> = {
  success: 'bg-success/25 text-success ring-1 ring-success/30',
  warning: 'bg-warning/25 text-warning ring-1 ring-warning/30',
  critical: 'bg-error/25 text-error ring-1 ring-error/30',
  info: 'bg-info/25 text-info ring-1 ring-info/30',
  new: 'bg-accent/25 text-accent ring-1 ring-accent/30',
  neutral: 'bg-muted/20 text-muted',
};

const DOT_CLASSES: Record<'success' | 'warning' | 'critical' | 'info' | 'new' | 'neutral', string> =
  {
    success: 'bg-success',
    warning: 'bg-warning',
    critical: 'bg-error',
    info: 'bg-info',
    new: 'bg-accent',
    neutral: 'bg-muted',
  };

export type BadgeProps = PropsWithChildren<
  ComponentPropsWithoutRef<'span'> & {
    tone?: 'success' | 'warning' | 'critical' | 'info' | 'new' | 'neutral';
    dot?: boolean;
  }
>;

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  className = '',
  ...props
}: BadgeProps) {
  const toneClass = TONE_CLASSES[tone];
  const dotClass = DOT_CLASSES[tone];

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
        transition-transform duration-150
        hover:scale-105
        ${toneClass}
        ${className}
      `}
      {...props}
    >
      {dot ? (
        <span
          className={`size-1.5 shrink-0 rounded-full motion-safe:animate-[status-dot-pulse_2s_ease-in-out_infinite] ${dotClass}`}
          aria-hidden
        />
      ) : null}
      {children}
    </span>
  );
}
