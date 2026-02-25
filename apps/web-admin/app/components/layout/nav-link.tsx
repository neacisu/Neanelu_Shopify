import type { ComponentType, PropsWithChildren } from 'react';
import { useLocation } from 'react-router-dom';

import { InfoTooltip } from '../ui/info-tooltip';
import { ShopifyLink } from '../../shopify';

type IconType = ComponentType<{ className?: string }>;

export type NavLinkProps = PropsWithChildren<{
  to: string;
  icon?: IconType;
  badge?: number | string;
  /** Detailed explanation for new users; when set, an info icon with tooltip is shown next to the label. */
  tooltip?: string;
  /** Tooltip heading; defaults to the link label (children). */
  tooltipTitle?: string;
}>;

function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

export function NavLink({ to, icon: Icon, badge, tooltip, tooltipTitle, children }: NavLinkProps) {
  const location = useLocation();

  const current = normalizePathname(location.pathname);
  const target = normalizePathname(to);

  const isActive = current === target || (target !== '/' && current.startsWith(target + '/'));

  return (
    <ShopifyLink
      to={to}
      className={
        'group/link flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-all duration-200 ease-out ' +
        (isActive
          ? 'border-l-4 border-blue-500 bg-blue-50/80 text-slate-800 shadow-[var(--shadow-sm)]'
          : 'border-l-4 border-transparent text-slate-600 hover:translate-x-0.5 hover:bg-slate-100 hover:text-slate-800 hover:shadow-[var(--shadow-sm)]') +
        ' focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2'
      }
      aria-current={isActive ? 'page' : undefined}
    >
      <span className="inline-flex min-w-0 items-center gap-3">
        {Icon ? (
          <span
            className={
              'flex shrink-0 items-center justify-center transition-colors duration-200 ' +
              (isActive ? 'text-blue-600' : 'text-slate-400 group-hover/link:text-slate-600')
            }
          >
            <Icon className="size-4" />
          </span>
        ) : null}
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate">{children}</span>
          {tooltip ? (
            <InfoTooltip
              title={tooltipTitle ?? (typeof children === 'string' ? children : 'Info')}
              side="bottom"
              portalToBody
            >
              {tooltip}
            </InfoTooltip>
          ) : null}
        </span>
      </span>

      {badge !== undefined ? (
        <span className="shrink-0 rounded-full bg-slate-200/80 px-2 py-0.5 text-xs font-medium text-slate-600">
          {badge}
        </span>
      ) : null}
    </ShopifyLink>
  );
}
