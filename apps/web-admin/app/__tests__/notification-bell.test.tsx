import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NotificationBell } from '../components/layout/notification-bell';

const apiMock = {
  getApi: vi.fn((path: string) => {
    if (path === '/pim/notifications/unread-count') return { count: 2 };
    if (path === '/pim/notifications') {
      return {
        notifications: [
          {
            id: 'n-1',
            type: 'quality_event',
            title: 'Quality promoted',
            body: {},
            read: false,
            created_at: new Date().toISOString(),
          },
        ],
      };
    }
    return {};
  }),
  putApi: vi.fn(() => Promise.resolve({ updated: 1 })),
};

vi.mock('../hooks/use-api', () => ({
  useApiClient: () => apiMock,
}));

vi.mock('../hooks/use-polling', () => ({
  usePolling: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'notifications-unread') {
      return { data: { count: 2 }, refetch: vi.fn() };
    }
    return {
      data: {
        notifications: [
          {
            id: 'n-1',
            type: 'quality_event',
            title: 'Quality promoted',
            body: {},
            read: false,
            created_at: new Date().toISOString(),
          },
        ],
      },
      refetch: vi.fn(),
    };
  },
}));

vi.mock('../hooks/useEnrichmentStream', () => ({
  useEnrichmentStream: () => ({ events: [], connected: true, error: null }),
}));

describe('notification bell', () => {
  it('opens dropdown and marks all read', async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByRole('button', { name: /Notificari/i }));
    expect(screen.getByText(/Notificari/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Marcheaza toate ca citite/i }));
    expect(apiMock.putApi).toHaveBeenCalled();
  });
});
