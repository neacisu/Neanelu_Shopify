import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useLogStream } from '../hooks/use-log-stream';

let originalEventSource: typeof EventSource | undefined;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean | undefined;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.withCredentials = init?.withCredentials;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emitOpen() {
    this.onopen?.(new Event('open'));
  }

  emitMessage(payload: unknown) {
    const data = JSON.stringify(payload);
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError() {
    this.onerror?.(new Event('error'));
  }
}

afterEach(() => {
  MockEventSource.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).EventSource = originalEventSource;
});

describe('useLogStream', () => {
  it('builds endpoint with shopId + levels and buffers entries', () => {
    originalEventSource = global.EventSource;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).EventSource = MockEventSource;

    const { result } = renderHook(() =>
      useLogStream({
        endpoint: '/api/bulk/1/logs/stream',
        shopId: 'shop-1',
        levels: ['info', 'error'],
        bufferSize: 2,
        enabled: true,
      })
    );

    const instance = MockEventSource.instances[0];
    expect(instance).toBeDefined();
    if (!instance) throw new Error('Missing EventSource instance');
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
