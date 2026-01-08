import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { useQueueStream } from '../hooks/use-queue-stream';

vi.mock('../lib/session-auth', () => ({
  getSessionAuthHeaders: () => Promise.resolve({}),
}));

function Harness(props: { onEvent: (e: unknown) => void }) {
  const { connected, error } = useQueueStream({
    enabled: true,
    onEvent: (e) => props.onEvent(e),
  });

  return (
    <div>
      <div data-testid="connected">{connected ? 'yes' : 'no'}</div>
      <div data-testid="error">{error ?? ''}</div>
    </div>
  );
}

describe('useQueueStream (polling)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('polls /api/queues and emits queues.snapshot events', async () => {
    const events: unknown[] = [];

    const mockQueues = [
      { name: 'webhooks', waiting: 1, active: 0, delayed: 0, completed: 0, failed: 0 },
    ];

    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(mockQueues), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const view = render(<Harness onEvent={(e) => events.push(e)} />);

    await waitFor(() => {
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    const snapshot = events.find((e) => (e as { type?: string }).type === 'queues.snapshot');
    expect(snapshot).toBeTruthy();

    // Verify connected status
    await waitFor(() => {
      expect(screen.getByTestId('connected').textContent).toBe('yes');
    });

    view.unmount();
  });

  it('exposes error state if the polling endpoint fails', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(() => Promise.resolve(new Response('nope', { status: 500 })));

    render(<Harness onEvent={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toMatch(/polling_http_500/);
    });
  });
});
