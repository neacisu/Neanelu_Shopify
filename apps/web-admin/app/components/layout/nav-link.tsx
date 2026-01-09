import type { ComponentType, PropsWithChildren } from 'react';
import { useLocation } from 'react-router-dom';

import { ShopifyLink } from '../../shopify';

type IconType = ComponentType<{ className?: string }>;

export type NavLinkProps = PropsWithChildren<{
  to: string;
  icon?: IconType;
  badge?: number | string;
}>;

function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

export function NavLink({ to, icon: Icon, badge, children }: NavLinkProps) {
  const location = useLocation();

  const current = normalizePathname(location.pathname);
  const target = normalizePathname(to);

  const isActive = current === target || (target !== '/' && current.startsWith(target + '/'));

  return (
    <ShopifyLink
      to={to}
      className={
        'group flex items-center justify-between gap-3 rounded-md px-3 py-2 text-body outline-none transition-all duration-200 ease-in-out ' +
        (isActive
          ? 'border-l-4 border-primary bg-primary/10 text-foreground shadow-sm'
          : 'border-l-4 border-transparent text-foreground/70 hover:bg-muted/15 hover:text-foreground hover:border-black/5 hover:translate-x-1') +
        ' focus-visible:ring-2 focus-visible:ring-primary/40'
      }
      aria-current={isActive ? 'page' : undefined}
    >
      <span className="inline-flex min-w-0 items-center gap-3">
        {Icon ? <Icon className="size-4 shrink-0 text-muted group-hover:text-foreground" /> : null}
        <span className="truncate">{children}</span>
      </span>

      {badge !== undefined ? (
        <span className="rounded-full bg-muted/15 px-2 py-0.5 text-caption text-muted">
          {badge}
        </span>
      ) : null}
    </ShopifyLink>
  );
}
