import type { PropsWithChildren } from 'react';
import { useMemo, useState } from 'react';
import { Cpu, LayoutDashboard, Menu, Search, Settings, UserRound, Workflow } from 'lucide-react';

import { NavLink } from './nav-link';

export type AppShellProps = PropsWithChildren<{
  sidebarOpen?: boolean;
  onSidebarToggle?: () => void;
}>;

interface NavItem {
  to: string;
  label: string;
  icon?: Parameters<typeof NavLink>[0]['icon'];
}

export function AppShell({
  children,
  sidebarOpen: controlledSidebarOpen,
  onSidebarToggle,
}: AppShellProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);

  const isControlled = controlledSidebarOpen !== undefined;
  const sidebarOpen = isControlled ? controlledSidebarOpen : uncontrolledOpen;

  const toggleSidebar = () => {
    onSidebarToggle?.();
    if (!isControlled) setUncontrolledOpen((value) => !value);
  };

  const navItems: NavItem[] = useMemo(
    () => [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/queues', label: 'Queues', icon: Cpu },
      { to: '/ingestion', label: 'Ingestion', icon: Workflow },
      { to: '/search', label: 'Search', icon: Search },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
    []
  );

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-body focus:shadow-md"
      >
        Skip to content
      </a>

      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[280px_1fr]">
        <aside
          className={
            'border-r border-muted/20 bg-background md:block ' + (sidebarOpen ? 'block' : 'hidden')
          }
        >
          <nav role="navigation" className="flex h-full flex-col gap-2 p-4">
            <div className="text-h6">Neanelu</div>
            <div className="mt-1 text-caption text-muted">Shopify Manager</div>

            <div className="mt-4 flex flex-col gap-1">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} {...(item.icon ? { icon: item.icon } : {})}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="border-b border-muted/20 bg-background">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-muted/20 bg-background px-3 py-2 text-caption text-foreground shadow-sm hover:bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:hidden"
                onClick={toggleSidebar}
                aria-label="Toggle sidebar"
              >
                <Menu className="size-4" />
                Menu
              </button>

              <div className="min-w-0 text-caption text-muted">
                <label className="sr-only" htmlFor="shop-selector">
                  Shop
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-foreground/80">Shop</span>
                  <select
                    id="shop-selector"
                    defaultValue="demo"
                    className="rounded-md border border-muted/20 bg-background px-2 py-1 text-body text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="demo">demo.myshopify.com</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-muted/20 bg-background px-3 py-2 text-caption text-foreground shadow-sm hover:bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label="Open user menu"
              >
                <UserRound className="size-4" />
                Admin
              </button>
            </div>
          </header>

          <main id="main" className="min-w-0 flex-1 overflow-y-auto p-4">
            {children}
          </main>
        </div>
      </div>

      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-foreground/30 md:hidden"
          onClick={toggleSidebar}
          aria-label="Close sidebar overlay"
        />
      ) : null}
    </div>
  );
}
