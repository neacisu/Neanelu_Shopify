import * as React from 'react';
import { useState } from 'react';
import type { ComponentPropsWithoutRef } from 'react';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'positive'
  | 'destructive'
  | 'neutral'
  | 'ghost'
  | 'link';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'secondary',
      size = 'md',
      loading,
      children,
      disabled,
      onMouseDown,
      ...props
    },
    ref
  ) => {
    const [ripple, setRipple] = useState<{ x: number; y: number; show: boolean }>({
      x: 0,
      y: 0,
      show: false,
    });

    const baseStyles =
      'group relative inline-flex items-center justify-center overflow-hidden whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

    const variants: Record<ButtonVariant, string> = {
      primary:
        'border border-transparent bg-slate-900 text-white shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:bg-gradient-to-r hover:from-slate-800 hover:to-slate-700 hover:shadow-lg hover:shadow-slate-900/20 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
      secondary:
        'border border-slate-200 bg-white text-slate-700 shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-[var(--shadow-md)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
      positive:
        'border border-emerald-200 bg-white text-emerald-700 shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:bg-emerald-600 hover:text-white hover:shadow-[var(--shadow-md)] hover:animate-[pulse-soft_1s_ease-in-out_infinite] dark:border-emerald-900 dark:bg-slate-900 dark:text-emerald-300',
      destructive:
        'border border-rose-200 bg-white text-rose-700 shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:bg-rose-600 hover:text-white hover:shadow-[var(--shadow-md)] hover:animate-[shake_0.3s_ease-in-out] dark:border-rose-900 dark:bg-slate-900 dark:text-rose-300',
      neutral:
        'border border-amber-200 bg-white text-amber-700 shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:bg-amber-500 hover:text-slate-900 hover:shadow-[var(--shadow-md)] dark:border-amber-900 dark:bg-slate-900 dark:text-amber-300',
      ghost:
        'border border-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800',
      link: 'border border-transparent text-slate-900 underline-offset-4 hover:underline dark:text-slate-100',
    };

    const sizes: Record<ButtonSize, string> = {
      sm: 'h-8 rounded-md px-3',
      md: 'h-9 px-4 py-2',
      lg: 'h-11 rounded-md px-8',
      icon: 'h-10 w-10',
    };

    const variantClass = variants[variant] ?? variants.secondary;
    const sizeClass = sizes[size] ?? sizes.md;
    const loadingClass = loading ? 'cursor-not-allowed opacity-80' : '';

    const combinedClassName = `${baseStyles} ${variantClass} ${sizeClass} ${loadingClass} ${className ?? ''}`;

    const handleMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setRipple({ x, y, show: true });
      setTimeout(() => setRipple((r) => ({ ...r, show: false })), 500);
      onMouseDown?.(e);
    };

    return (
      <button
        className={combinedClassName}
        ref={ref}
        disabled={(disabled ?? false) || (loading ?? false)}
        onMouseDown={handleMouseDown}
        {...props}
      >
        {ripple.show ? (
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-full bg-white/30 animate-[ripple_0.5s_ease-out]"
            style={{
              left: ripple.x,
              top: ripple.y,
              width: 20,
              height: 20,
              marginLeft: -10,
              marginTop: -10,
            }}
          />
        ) : null}
        {loading ? (
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : null}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
