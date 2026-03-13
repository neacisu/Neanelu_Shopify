import { forwardRef } from 'react';
import type React from 'react';
import type { ComponentPropsWithoutRef, HTMLAttributes, PropsWithChildren } from 'react';

export type CardVariant = 'default' | 'glass' | 'bordered' | 'elevated' | 'interactive';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CardTone = 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary';

export type CardProps = PropsWithChildren<
  ComponentPropsWithoutRef<'div'> & {
    variant?: CardVariant;
    padding?: CardPadding;
    tone?: CardTone;
  }
>;

type CardSectionProps = PropsWithChildren<HTMLAttributes<HTMLDivElement>>;

const baseCardClass =
  'rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-sm)] transition-all duration-normal ease-out-enterprise';

const cardVariantClass: Record<CardVariant, string> = {
  default: 'hover-lift-card',
  glass: 'glass border-white/30 bg-[var(--glass-bg)] text-card-foreground',
  bordered: 'shadow-none',
  elevated: 'shadow-[var(--shadow-md)] border-primary/10',
  interactive:
    'hover-lift-card cursor-pointer border-primary/15 hover:border-primary/50 hover:bg-card active:translate-y-0',
};

const cardToneStyle: Record<CardTone, React.CSSProperties> = {
  default: {},
  success: {
    borderLeftWidth: '3px',
    borderLeftColor: 'rgba(34, 197, 94, 0.7)',
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  warning: {
    borderLeftWidth: '3px',
    borderLeftColor: 'rgba(234, 179, 8, 0.7)',
    borderColor: 'rgba(234, 179, 8, 0.3)',
  },
  error: {
    borderLeftWidth: '3px',
    borderLeftColor: 'rgba(239, 68, 68, 0.7)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  info: {
    borderLeftWidth: '3px',
    borderLeftColor: 'rgba(56, 189, 248, 0.7)',
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  primary: {
    borderLeftWidth: '3px',
    borderLeftColor: 'rgb(var(--color-primary))',
    borderColor: 'rgba(30, 96, 145, 0.3)',
  },
};

const cardPaddingClass: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

function joinClasses(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    children,
    className,
    variant = 'default',
    padding = 'md',
    tone = 'default',
    style,
    ...props
  }: CardProps,
  ref
) {
  return (
    <div
      ref={ref}
      className={joinClasses(
        baseCardClass,
        cardVariantClass[variant],
        cardPaddingClass[padding],
        className
      )}
      data-card-variant={variant}
      style={{ ...cardToneStyle[tone], ...style }}
      {...props}
    >
      {children}
    </div>
  );
});

export function CardHeader({ children, className, ...props }: CardSectionProps) {
  return (
    <div
      className={joinClasses('flex flex-col gap-1.5 border-b border-border pb-4', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardContent({ children, className, ...props }: CardSectionProps) {
  return (
    <div className={joinClasses('flex flex-col gap-4', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className, ...props }: CardSectionProps) {
  return (
    <div
      className={joinClasses(
        'mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
