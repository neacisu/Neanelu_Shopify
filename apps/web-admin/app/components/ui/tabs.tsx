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
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = React.useState({ width: 0, left: 0 });

  React.useEffect(() => {
    const root = listRef.current;
    if (!root) return;

    const activeTab = root.querySelector<HTMLButtonElement>(`button[data-tab-value="${value}"]`);
    if (!activeTab) {
      setIndicator({ width: 0, left: 0 });
      return;
    }

    setIndicator({
      width: activeTab.offsetWidth,
      left: activeTab.offsetLeft,
    });
  }, [items, value]);

  React.useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => {
      const activeTab = root.querySelector<HTMLButtonElement>(`button[data-tab-value="${value}"]`);
      if (!activeTab) return;
      setIndicator({
        width: activeTab.offsetWidth,
        left: activeTab.offsetLeft,
      });
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [value]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (items.length <= 1) return;
    const currentIndex = items.findIndex((item) => item.value === value);
    if (currentIndex < 0) return;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;

    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (currentIndex + direction + items.length) % items.length;
    const nextValue = items[nextIndex]?.value;
    if (nextValue) onValueChange(nextValue);
  };

  return (
    <div
      ref={listRef}
      className={`relative inline-flex items-center gap-1 rounded-xl border border-primary/20 bg-card p-1 shadow-[var(--shadow-sm)] ${className ?? ''}`}
      role="tablist"
      aria-label={ariaLabel ?? 'Tabs'}
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-1 top-1 z-0 rounded-lg bg-primary shadow-[var(--shadow-sm)] transition-[left,width] duration-300 ease-out"
        style={{
          width: `${indicator.width}px`,
          left: `${indicator.left}px`,
        }}
      />
      {items.map((item) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            id={`tab-${item.value}`}
            onClick={() => onValueChange(item.value)}
            data-tab-value={item.value}
            className={`
              relative z-10 inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold
              transition-all duration-200
              focus-ring-standard
              disabled:pointer-events-none disabled:opacity-50
              ${
                isActive
                  ? 'text-primary-foreground'
                  : 'text-muted hover:bg-primary/8 hover:text-primary'
              }
            `}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${item.value}`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * TabPanel cu animație cross-fade la schimbarea tab-ului.
 * Înregistrată cu role="tabpanel" pentru accesibilitate WCAG 2.2.
 */
export interface TabPanelProps {
  id?: string;
  activeTabValue: string;
  tabValue: string;
  children: React.ReactNode;
  className?: string;
}

export function TabPanel({
  id,
  activeTabValue,
  tabValue,
  children,
  className = '',
}: TabPanelProps) {
  const isActive = activeTabValue === tabValue;

  return (
    <div
      id={id ?? `tabpanel-${tabValue}`}
      role="tabpanel"
      aria-labelledby={`tab-${tabValue}`}
      className={`
        ${isActive ? 'block motion-safe:animate-[fadeSlideUp_0.2s_ease-out]' : 'hidden'}
        ${className}
      `}
    >
      {children}
    </div>
  );
}
