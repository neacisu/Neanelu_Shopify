import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

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
  const Sep = separator ?? <ChevronRight className="size-4 text-muted" />;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-500"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const key = `${item.label}-${index}`;

        return (
          <span key={key} className="inline-flex items-center gap-2">
            {index > 0 ? (
              <span className="text-slate-300" aria-hidden>
                {Sep}
              </span>
            ) : null}

            {item.href && !isLast ? (
              <ShopifyLink className="transition-colors hover:text-slate-800" to={item.href}>
                {item.label}
              </ShopifyLink>
            ) : (
              <span
                aria-current={isLast ? 'page' : undefined}
                className={isLast ? 'font-medium text-slate-700' : 'text-slate-500'}
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
