import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

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
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-caption text-muted">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const key = `${item.label}-${index}`;

        return (
          <span key={key} className="inline-flex items-center gap-2">
            {index > 0 ? Sep : null}

            {item.href && !isLast ? (
              <Link className="hover:text-foreground" to={item.href}>
                {item.label}
              </Link>
            ) : (
              <span aria-current={isLast ? 'page' : undefined} className="text-foreground/80">
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
