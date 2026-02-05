import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useLogStream } from '../hooks/use-log-stream';

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

afterEach(() => {
  MockWebSocket.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).WebSocket = originalWebSocket;
});

describe('useLogStream', () => {
  it('builds endpoint with shopId + levels and buffers entries', () => {
    originalWebSocket = global.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).WebSocket = MockWebSocket;

    const { result } = renderHook(() =>
      useLogStream({
        endpoint: '/api/bulk/1/logs/ws',
        shopId: 'shop-1',
        levels: ['info', 'error'],
        bufferSize: 2,
        enabled: true,
      })
    );

    const instance = MockWebSocket.instances[0];
    expect(instance).toBeDefined();
    if (!instance) throw new Error('Missing WebSocket instance');
    expect(instance.url).toContain('shopId=shop-1');
    expect(instance.url).toContain('levels=info%2Cerror');

    act(() => {
      instance.emitOpen();
      instance.emitMessage({ level: 'info', message: 'one', timestamp: '2024-01-01T00:00:00Z' });
      instance.emitMessage([
        { level: 'info', message: 'two', timestamp: '2024-01-01T00:00:01Z' },
        { level: 'error', message: 'three', timestamp: '2024-01-01T00:00:02Z' },
      ]);
    });

    expect(result.current.logs).toHaveLength(2);
    expect(result.current.logs.map((l) => l.message)).toEqual(['two', 'three']);
  });
});
