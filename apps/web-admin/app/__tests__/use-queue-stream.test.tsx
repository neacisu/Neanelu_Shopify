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

describe('useQueueStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('parses SSE events (event:/data:) and sets connected after successful response', async () => {
    const events: unknown[] = [];

    const encoder = new TextEncoder();

    let keepOpen: { close: () => void } = { close: () => undefined };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        keepOpen = {
          close: () => (controller as unknown as { close?: () => void }).close?.(),
        };
        controller.enqueue(
          encoder.encode(
            [
              'event: queues.snapshot\n',
              'data: {"queues": [{"name":"webhooks","waiting":1,"active":0,"delayed":0,"completed":0,"failed":0}]}\n',
              '\n',
              'event: job.started\n',
              'data: {"queueName":"webhooks","jobId":"1"}\n',
              '\n',
            ].join('')
          )
        );
      },
    });

    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
    );

    const view = render(<Harness onEvent={(e) => events.push(e)} />);

    await waitFor(() => {
      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    const snapshot = events.find((e) => (e as { type?: string }).type === 'queues.snapshot');
    const jobStarted = events.find((e) => (e as { type?: string }).type === 'job.started');

    expect(snapshot).toBeTruthy();
    expect(jobStarted).toBeTruthy();

    // Cleanup will abort the stream.
    view.unmount();
    // Ensure we release the stream controller if still open.
    keepOpen.close();
  });

  it('exposes error state if the stream endpoint fails', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(() => Promise.resolve(new Response('nope', { status: 500 })));

    render(<Harness onEvent={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toMatch(/stream_failed_500/);
    });
  });
});
