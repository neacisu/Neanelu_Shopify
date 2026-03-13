import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { ShopifyLink } from '../../shopify';
import { Select, type SelectOption } from '../ui/select';

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
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const key = `${item.label}-${index}`;

        return (
          <span key={key} className="inline-flex items-center gap-2">
            {index > 0 ? (
              <span className="text-muted" aria-hidden>
                {Sep}
              </span>
            ) : null}

            {item.href && !isLast ? (
              <ShopifyLink className="transition-colors hover:text-foreground" to={item.href}>
                {item.label}
              </ShopifyLink>
            ) : (
              <span
                aria-current={isLast ? 'page' : undefined}
                className={isLast ? 'font-medium text-foreground' : 'text-muted'}
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
      {jumpOptions.length > 1 ? (
        <div className="ml-1 w-32">
          <Select
            label=""
            options={[
              { value: '', label: 'Salt rapid' } as SelectOption,
              ...jumpOptions.map(
                (item): SelectOption => ({
                  value: item.href ?? '',
                  label: item.label,
                })
              ),
            ]}
            value=""
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              void navigate(value);
            }}
            aria-label="Navigare rapidă breadcrumb"
          />
        </div>
      ) : null}
    </nav>
  );
}
