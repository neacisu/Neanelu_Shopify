import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { useQueueStream } from '../hooks/use-queue-stream';

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

let originalWebSocket: typeof WebSocket | undefined;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 1;
  private listeners: Record<string, ((event: Event) => void)[]> = {};
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners[type] ??= [];
    this.listeners[type]?.push(listener);
  }

  close() {
    this.closed = true;
    this.emit('close');
  }

  emitOpen() {
    this.emit('open');
  }

  emitMessage(payload: unknown) {
    const data = JSON.stringify(payload);
    this.emit('message', { data } as MessageEvent);
  }

  emitError() {
    this.emit('error');
  }

  private emit(type: string, event: Event = new Event(type)) {
    const list = this.listeners[type] ?? [];
    list.forEach((listener) => listener(event));
  }
}

describe('useQueueStream (websocket)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    originalWebSocket = global.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    cleanup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).WebSocket = originalWebSocket;
    MockWebSocket.instances = [];
  });

  it('connects to /api/queues/ws and emits queues.snapshot events', async () => {
    const events: unknown[] = [];
    const view = render(<Harness onEvent={(e) => events.push(e)} />);

    const instance = MockWebSocket.instances[0];
    expect(instance).toBeDefined();
    if (!instance) throw new Error('Missing WebSocket instance');
    expect(instance.url).toContain('/api/queues/ws');

    act(() => {
      instance.emitOpen();
      instance.emitMessage({
        event: 'queues.snapshot',
        data: {
          timestamp: new Date().toISOString(),
          queues: [{ name: 'webhooks', waiting: 1 }],
          workers: { webhookWorkerOk: true, tokenHealthWorkerOk: true },
        },
      });
    });

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

  it('exposes error state when websocket errors', async () => {
    render(<Harness onEvent={() => undefined} />);

    const instance = MockWebSocket.instances[0];
    if (!instance) throw new Error('Missing WebSocket instance');

    act(() => {
      instance.emitError();
    });

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toMatch(/stream_disconnected/);
    });
  });
});
