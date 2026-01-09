import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from 'sonner';

const postApiMock = vi.hoisted(() => vi.fn());
const getJsonMock = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../lib/api-client', () => ({
  createApiClient: () => ({
    postApi: postApiMock,
    getJson: getJsonMock,
  }),
}));

vi.mock('../../../lib/session-auth', () => ({
  getSessionAuthHeaders: () => Promise.resolve({}),
}));

import { QuickActionsPanel } from './QuickActionsPanel';

describe('QuickActionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Reconcile Webhooks calls backend and shows toast', async () => {
    postApiMock.mockResolvedValueOnce({ jobId: 'job-1' });

    render(<QuickActionsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Reconcile Webhooks/i }));

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith('/dashboard/actions/start-sync', {});
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it('Clear Cache requires confirm and then calls backend', async () => {
    postApiMock.mockResolvedValueOnce({ deletedKeys: 3, truncated: false });

    render(<QuickActionsPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Clear Cache/i }));
    // no API call until confirm
    expect(postApiMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith('/dashboard/actions/clear-cache', {
        confirm: true,
        patterns: ['dashboard:*', 'cache:*'],
      });
    });

    expect(toast.success).toHaveBeenCalled();
  });

  it('Check Health calls /health/ready and shows toast', async () => {
    getJsonMock.mockResolvedValueOnce({ status: 'ready' });
    render(<QuickActionsPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Check Health/i }));
    await waitFor(() => {
      expect(getJsonMock).toHaveBeenCalledWith('/health/ready');
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it('View Logs opens a new tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<QuickActionsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /View Logs/i }));
    expect(openSpy).toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
