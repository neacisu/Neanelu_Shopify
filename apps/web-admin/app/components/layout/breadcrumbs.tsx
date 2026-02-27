import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { ShopifyLink } from '../../shopify';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  separator?: ReactNode;
}

export function Breadcrumbs({ items, separator }: BreadcrumbsProps) {
  const navigate = useNavigate();
  const Sep = separator ?? <ChevronRight className="size-4 text-muted" />;
  const jumpOptions = useMemo(() => items.filter((item) => Boolean(item.href)), [items]);

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-500 dark:text-slate-400"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const key = `${item.label}-${index}`;

        return (
          <span key={key} className="inline-flex items-center gap-2">
            {index > 0 ? (
              <span className="text-slate-300 dark:text-slate-600" aria-hidden>
                {Sep}
              </span>
            ) : null}

            {item.href && !isLast ? (
              <ShopifyLink
                className="transition-colors hover:text-slate-800 dark:hover:text-slate-100"
                to={item.href}
              >
                {item.label}
              </ShopifyLink>
            ) : (
              <span
                aria-current={isLast ? 'page' : undefined}
                className={
                  isLast
                    ? 'font-medium text-slate-700 dark:text-slate-200'
                    : 'text-slate-500 dark:text-slate-400'
                }
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
      {jumpOptions.length > 1 ? (
        <select
          className="ml-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 outline-none transition hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-ring))]/40 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600"
          defaultValue=""
          onChange={(event) => {
            const value = event.target.value;
            if (!value) return;
            void navigate(value);
          }}
          aria-label="Navigare rapidă breadcrumb"
        >
          <option value="" disabled>
            Salt rapid
          </option>
          {jumpOptions.map((item) => (
            <option key={`${item.label}-${item.href}`} value={item.href}>
              {item.label}
            </option>
          ))}
        </select>
      ) : null}
    </nav>
  );
}
