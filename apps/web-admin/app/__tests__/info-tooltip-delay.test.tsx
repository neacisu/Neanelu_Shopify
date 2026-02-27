import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { InfoTooltip } from '../components/ui/info-tooltip';

describe('InfoTooltip – hover delay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tooltip is not visible immediately on hover', () => {
    render(<InfoTooltip title="Test Title">Tooltip content</InfoTooltip>);

    const trigger = screen.getByRole('button');
    fireEvent.mouseEnter(trigger);

    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip).toHaveAttribute('aria-hidden', 'true');
  });

  it('tooltip becomes visible after 200ms delay', () => {
    render(<InfoTooltip title="Test Title">Tooltip content</InfoTooltip>);

    const trigger = screen.getByRole('button');
    fireEvent.mouseEnter(trigger);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Tooltip content')).toBeInTheDocument();
  });

  it('tooltip has maxWidth of at least 360px', () => {
    render(<InfoTooltip title="Title">Content</InfoTooltip>);

    const trigger = screen.getByRole('button');
    fireEvent.mouseEnter(trigger);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const tooltip = screen.getByRole('tooltip', { hidden: true });
    const width = parseInt(String(tooltip.style.width || tooltip.style.maxWidth), 10);
    expect(width).toBeGreaterThanOrEqual(360);
  });

  it('Escape closes the tooltip', () => {
    render(<InfoTooltip title="Title">Content</InfoTooltip>);

    const trigger = screen.getByRole('button');
    fireEvent.mouseEnter(trigger);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip).toHaveAttribute('aria-hidden', 'false');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(tooltip).toHaveAttribute('aria-hidden', 'true');
  });

  it('tooltip disappears after mouse leaves (with close delay)', () => {
    render(<InfoTooltip title="Title">Content</InfoTooltip>);

    const trigger = screen.getByRole('button');
    fireEvent.mouseEnter(trigger);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip).toHaveAttribute('aria-hidden', 'false');

    fireEvent.mouseLeave(trigger);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(tooltip).toHaveAttribute('aria-hidden', 'true');
  });
});
