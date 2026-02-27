import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../hooks/use-similarity-matches', () => ({
  usePendingSimilarityMatchCount: () => 0,
}));

vi.mock('../components/layout/nav-link', () => ({
  NavLink: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('../components/layout/shop-selector', () => ({
  ShopSelector: () => <div data-testid="shop-selector" />,
}));

vi.mock('../components/layout/notification-bell', () => ({
  NotificationBell: () => <button data-testid="notification-bell" />,
}));

vi.mock('../components/ui/info-tooltip', () => ({
  InfoTooltip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('../components/layout/command-palette', () => ({
  CommandPalette: () => null,
}));

import { AppShell } from '../components/layout/app-shell';

describe('Dark mode toggle', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark', 'light');
    window.localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark', 'light');
    window.localStorage.clear();
  });

  it('toggles dark class on document.documentElement when clicking the theme button', async () => {
    const user = userEvent.setup();
    render(<AppShell sidebarOpen>Content</AppShell>);

    const themeButton = screen.getByRole('button', { name: 'Comută tema' });

    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(themeButton);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await user.click(themeButton);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('persists dark mode preference to localStorage', async () => {
    const user = userEvent.setup();
    render(<AppShell sidebarOpen>Content</AppShell>);

    const themeButton = screen.getByRole('button', { name: 'Comută tema' });

    await user.click(themeButton);
    expect(window.localStorage.getItem('neanelu.theme')).toBe('dark');

    await user.click(themeButton);
    expect(window.localStorage.getItem('neanelu.theme')).toBe('light');
  });

  it('initializes dark mode from localStorage', () => {
    window.localStorage.setItem('neanelu.theme', 'dark');
    render(<AppShell sidebarOpen>Content</AppShell>);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('sidebar has dark: classes in the aside element', () => {
    const { container } = render(<AppShell sidebarOpen>Content</AppShell>);

    const aside = container.querySelector('aside');
    expect(aside).toBeInTheDocument();
    expect(aside?.className).toContain('dark:');
  });
});
