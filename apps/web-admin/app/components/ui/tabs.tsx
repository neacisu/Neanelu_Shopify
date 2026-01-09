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
}

export function Tabs({ items, value, onValueChange, className }: TabsProps) {
  return (
    <div
      className={`inline-flex h-10 items-center justify-center rounded-md bg-muted/10 p-1 text-muted-foreground ${className ?? ''}`}
    >
      {items.map((item) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onValueChange(item.value)}
            className={`
              inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50
              ${
                isActive
                  ? 'bg-white text-foreground shadow-sm'
                  : 'hover:bg-black/5 hover:text-foreground'
              }
            `}
            aria-pressed={isActive}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
