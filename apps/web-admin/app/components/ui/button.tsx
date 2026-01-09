import * as React from 'react';
import type { ComponentPropsWithoutRef } from 'react';

// Using clsx/tailwind-merge pattern is standard but I don't see them in package.json context
// I will use simple template literals for now to avoid dependency issues if not installed.
// The user asked to standardize Black/White but specialized Hovers.

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
    { className, variant = 'secondary', size = 'md', loading, children, disabled, ...props },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

    // Variant Styles
    // Requirement: "Standardized white/black standard... but change to vivid colors on mouse-hover"
    // So default state is mostly monochrome.

    const variants: Record<ButtonVariant, string> = {
      primary: 'bg-primary text-white hover:bg-primary/90 shadow-sm border border-transparent', // Keep primary distinctive
      secondary:
        'bg-white text-black border border-gray-200 shadow-sm hover:bg-gray-100 dark:bg-black dark:text-white dark:border-gray-800 dark:hover:bg-gray-800', // Standard "White/Black"
      positive:
        'bg-white text-black border border-gray-200 shadow-sm hover:bg-emerald-500 hover:text-white hover:border-emerald-600', // "Nuante de verde" on hover
      destructive:
        'bg-white text-black border border-gray-200 shadow-sm hover:bg-red-500 hover:text-white hover:border-red-600', // "Nuante de rosu" on hover
      neutral:
        'bg-white text-black border border-gray-200 shadow-sm hover:bg-amber-400 hover:text-black hover:border-amber-500', // "Nuante portocalii/galben" on hover
      ghost: 'hover:bg-gray-100 hover:text-gray-900 border-transparent',
      link: 'text-primary underline-offset-4 hover:underline',
    };

    const sizes: Record<ButtonSize, string> = {
      sm: 'h-8 rounded-md px-3',
      md: 'h-9 px-4 py-2',
      lg: 'h-11 rounded-md px-8',
      icon: 'h-10 w-10',
    };

    const variantClass = variants[variant] ?? variants.secondary;
    const sizeClass = sizes[size] ?? sizes.md;
    const loadingClass = loading ? 'opacity-70 cursor-not-allowed' : '';

    const combinedClassName = `${baseStyles} ${variantClass} ${sizeClass} ${loadingClass} ${className ?? ''}`;

    return (
      <button
        className={combinedClassName}
        ref={ref}
        disabled={(disabled ?? false) || (loading ?? false)}
        {...props}
      >
        {loading ? (
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : null}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
