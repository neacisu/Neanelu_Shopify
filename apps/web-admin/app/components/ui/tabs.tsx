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
      className={`relative inline-flex items-center gap-1 rounded-xl border border-slate-200/80 bg-white/70 p-1 shadow-[var(--shadow-sm)] backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-slate-700/70 dark:bg-slate-900/70 dark:supports-[backdrop-filter]:bg-slate-900/60 ${className ?? ''}`}
      role="tablist"
      aria-label={ariaLabel ?? 'Tabs'}
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-1 top-1 z-0 rounded-lg bg-white shadow-[var(--shadow-sm)] ring-1 ring-slate-200/80 transition-[left,width] duration-300 ease-out dark:bg-slate-800 dark:ring-slate-700/80"
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
            onClick={() => onValueChange(item.value)}
            data-tab-value={item.value}
            className={`
              relative z-10 inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-blue-400/40 dark:focus-visible:ring-offset-slate-900
              ${
                isActive
                  ? 'text-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900 hover:shadow-[var(--shadow-sm)] dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
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
