import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { VirtualizedList } from '../components/ui/VirtualizedList';

// TanStack Virtual uses ResizeObserver for measurements.
// Some jsdom versions provide ResizeObserver but don't trigger callbacks.
// Force a deterministic stub for this test.

class ResizeObserverStub {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    const element = target as HTMLElement;
    const height = Number.parseFloat(element.style.height) || 0;
    const width = Number.parseFloat(element.style.width) || 0;

    this.callback(
      [
        {
          target,
          contentRect: {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: width,
            bottom: height,
            width,
            height,
            toJSON: () => ({ width, height }),
          } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver
    );
  }
  unobserve() {
    // noop
  }
  disconnect() {
    // noop
  }
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: ResizeObserverStub,
  configurable: true,
});

describe('VirtualizedList', () => {
  it('renders loading state', () => {
    render(
      <VirtualizedList
        items={[1, 2, 3]}
        renderItem={(v) => <div>{v}</div>}
        estimateSize={20}
        height={120}
        loading
      />
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    render(
      <VirtualizedList
        items={[]}
        renderItem={(v) => <div>{v}</div>}
        estimateSize={20}
        height={120}
      />
    );

    expect(screen.getByText('No items.')).toBeInTheDocument();
  });

  it('renders at least the first item', async () => {
    render(
      <VirtualizedList
        items={Array.from({ length: 200 }, (_, i) => i)}
        renderItem={(v) => <div>{`Row ${v}`}</div>}
        estimateSize={20}
        height={120}
        ariaLabel="List"
      />
    );

    const scroller = screen.getByLabelText('List');
    (scroller as HTMLDivElement).dispatchEvent(new Event('scroll', { bubbles: true }));

    expect(await screen.findByText('Row 0')).toBeInTheDocument();
  });

  it('calls loadMore when scrolled near the end', () => {
    const loadMore = vi.fn();

    render(
      <VirtualizedList
        items={Array.from({ length: 50 }, (_, i) => i)}
        renderItem={(v) => <div>{`Row ${v}`}</div>}
        estimateSize={20}
        height={120}
        ariaLabel="List"
        loadMore={loadMore}
      />
    );

    const scroller = screen.getByLabelText('List');
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(scroller, 'scrollTop', {
      value: 900,
      configurable: true,
      writable: true,
    });

    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(loadMore).toHaveBeenCalled();
  });

  it('supports keyboard navigation between rows', async () => {
    const user = userEvent.setup();

    render(
      <VirtualizedList
        items={Array.from({ length: 30 }, (_, i) => i)}
        renderItem={(v) => <div>{`Row ${v}`}</div>}
        estimateSize={20}
        height={120}
        ariaLabel="List"
        keyboardNavigation
      />
    );

    const first = screen.getAllByRole('option')[0]!;
    first.focus();
    await user.keyboard('{ArrowDown}');

    await new Promise((r) => setTimeout(r, 0));
    expect((document.activeElement as HTMLElement).getAttribute('data-virtualized-index')).toBe(
      '1'
    );
  });
});
