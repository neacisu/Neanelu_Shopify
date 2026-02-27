import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { Button } from '../components/ui/button';

describe('Button – ripple effect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a ripple span on mouseDown with correct position', () => {
    const { container } = render(<Button>Click me</Button>);
    const btn = screen.getByRole('button', { name: 'Click me' });

    Object.defineProperty(btn, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        top: 50,
        width: 200,
        height: 40,
        right: 300,
        bottom: 90,
        x: 100,
        y: 50,
        toJSON() {
          /* DOMRect stub */
        },
      }),
    });

    fireEvent.mouseDown(btn, { clientX: 130, clientY: 65 });

    const ripple = container.querySelector('[aria-hidden="true"]');
    expect(ripple).toBeInTheDocument();
    expect(ripple).toHaveClass('animate-[ripple_0.5s_ease-out]');
    expect(ripple).toHaveStyle({ left: '30px', top: '15px' });
  });

  it('ripple disappears after 500ms timeout', () => {
    const { container } = render(<Button>Click me</Button>);
    const btn = screen.getByRole('button', { name: 'Click me' });

    Object.defineProperty(btn, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 40,
        right: 100,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON() {
          /* DOMRect stub */
        },
      }),
    });

    fireEvent.mouseDown(btn, { clientX: 50, clientY: 20 });
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(
      container.querySelector('.animate-\\[ripple_0\\.5s_ease-out\\]')
    ).not.toBeInTheDocument();
  });

  it.each(['primary', 'secondary', 'destructive', 'positive', 'ghost'] as const)(
    'renders variant "%s" without error',
    (variant) => {
      render(<Button variant={variant}>Btn</Button>);
      expect(screen.getByRole('button', { name: 'Btn' })).toBeInTheDocument();
    }
  );

  it('shows spinner when loading', () => {
    const { container } = render(<Button loading>Loading</Button>);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('disabled state disables the button', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();
  });

  it('calls original onMouseDown alongside ripple', () => {
    const onMouseDown = vi.fn();
    render(<Button onMouseDown={onMouseDown}>Click</Button>);
    const btn = screen.getByRole('button', { name: 'Click' });

    Object.defineProperty(btn, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 40,
        right: 100,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON() {
          /* DOMRect stub */
        },
      }),
    });

    fireEvent.mouseDown(btn, { clientX: 10, clientY: 10 });
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });
});
