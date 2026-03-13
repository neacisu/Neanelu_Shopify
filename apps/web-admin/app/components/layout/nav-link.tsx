import type { ComponentType, PropsWithChildren } from 'react';
import { useLocation } from 'react-router-dom';

import { InfoTooltip } from '../ui/info-tooltip';
import { ShopifyLink } from '../../shopify';

type IconType = ComponentType<{ className?: string }>;

export type NavLinkProps = PropsWithChildren<{
  to: string;
  icon?: IconType;
  badge?: number | string;
  compact?: boolean;
  tooltip?: string;
  tooltipTitle?: string;
}>;

function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

export function NavLink({
  to,
  icon: Icon,
  badge,
  compact = false,
  tooltip,
  tooltipTitle,
  children,
}: NavLinkProps) {
  const location = useLocation();

  const current = normalizePathname(location.pathname);
  const target = normalizePathname(to);

  const isActive = current === target || (target !== '/' && current.startsWith(target + '/'));

  return (
    <ShopifyLink
      to={to}
      className={
        'group/link flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm outline-none transition-all duration-200 ease-out focus-ring-standard ' +
        (isActive
          ? 'font-semibold shadow-[var(--shadow-sm)]'
          : 'font-medium text-muted hover:translate-x-0.5 hover:shadow-[var(--shadow-sm)]') +
        (compact ? ' justify-center px-2.5' : '')
      }
      style={
        isActive
          ? {
              borderLeft: '3px solid rgb(var(--color-primary))',
              background:
                'linear-gradient(90deg, rgba(30, 96, 145, 0.22) 0%, rgba(30, 96, 145, 0.06) 100%)',
              color: 'rgb(var(--color-primary))',
            }
          : {
              borderLeft: '3px solid transparent',
            }
      }
      aria-current={isActive ? 'page' : undefined}
    >
      <span className="inline-flex min-w-0 items-center gap-3">
        {Icon ? (
          <span
            className={
              'flex shrink-0 items-center justify-center transition-[color,transform] duration-200 group-hover/link:scale-110 ' +
              (isActive ? 'text-primary' : 'text-muted group-hover/link:text-foreground')
            }
          >
            <Icon className="size-4" />
          </span>
        ) : null}
        {!compact ? (
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
        ) : null}
      </span>

      {badge !== undefined && !compact ? (
        <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/20 motion-safe:animate-[number-pop_0.3s_ease-out]">
          {badge}
        </span>
      ) : null}
    </ShopifyLink>
  );
}
