import * as React from 'react';

export interface TabItem {
  label: React.ReactNode;
  value: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}

export function Tabs({ items, value, onValueChange, className, ariaLabel }: TabsProps) {
  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-xl border border-slate-200/90 bg-slate-50/50 p-1 shadow-[var(--shadow-sm)] ${className ?? ''}`}
      role="tablist"
      aria-label={ariaLabel ?? 'Tabs'}
    >
      {items.map((item) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onValueChange(item.value)}
            className={`
              inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50
              ${
                isActive
                  ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200/80'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-800 hover:shadow-[var(--shadow-sm)]'
              }
            `}
            role="tab"
            aria-selected={isActive}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
