import type { ComponentPropsWithoutRef, PropsWithChildren } from 'react';

export type CardProps = PropsWithChildren<
  ComponentPropsWithoutRef<'div'> & Record<string, unknown>
>;

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`
        rounded-xl border border-white/20 bg-white/70 shadow-[var(--shadow-sm)] backdrop-blur-sm
        transition-all duration-200
        hover:shadow-[var(--shadow-md)] hover:-translate-y-px
        dark:border-white/10 dark:bg-slate-900/70
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  );
}
