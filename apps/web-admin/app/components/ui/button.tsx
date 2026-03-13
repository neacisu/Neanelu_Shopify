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
      'group relative inline-flex items-center justify-center overflow-hidden whitespace-nowrap rounded-md text-sm font-medium transition-all duration-normal ease-out-enterprise focus-ring-standard disabled:pointer-events-none disabled:opacity-50';

    const variants: Record<ButtonVariant, string> = {
      primary:
        'border border-transparent bg-primary text-primary-foreground shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[var(--shadow-md)] active:translate-y-0 active:brightness-95',
      secondary:
        'border border-border bg-card text-foreground shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5 hover:shadow-[var(--shadow-md)] active:translate-y-0',
      positive:
        'border border-success/40 bg-success/10 text-success shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:bg-success hover:text-success-foreground hover:shadow-[var(--shadow-md)] active:translate-y-0',
      destructive:
        'border border-error/40 bg-error/10 text-error shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:bg-error hover:text-error-foreground hover:shadow-[var(--shadow-md)] active:translate-y-0',
      neutral:
        'border border-warning/40 bg-warning/10 text-warning shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:bg-warning hover:text-warning-foreground hover:shadow-[var(--shadow-md)] active:translate-y-0',
      ghost:
        'border border-transparent text-foreground hover:bg-primary/8 hover:text-primary active:bg-primary/12',
      link: 'border border-transparent text-primary underline-offset-4 hover:underline hover:text-primary/80',
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
        aria-busy={loading ? true : undefined}
        onMouseDown={handleMouseDown}
        {...props}
      >
        {ripple.show ? (
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-full bg-card/30 animate-[ripple_0.5s_ease-out]"
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
