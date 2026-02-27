import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Tabs } from '../components/ui/tabs';

const tabItems = [
  { label: 'Tab A', value: 'a' },
  { label: 'Tab B', value: 'b' },
  { label: 'Tab C', value: 'c' },
];

describe('Tabs – sliding indicator', () => {
  it('renders the indicator span with transition classes', () => {
    const { container } = render(<Tabs items={tabItems} value="a" onValueChange={vi.fn()} />);

    const indicator = container.querySelector('span[aria-hidden="true"]');
    expect(indicator).toBeInTheDocument();
    expect(indicator?.className).toContain('transition-[left,width]');
    expect(indicator?.className).toContain('duration-300');
  });

  it('renders all tab buttons with correct roles', () => {
    render(<Tabs items={tabItems} value="a" onValueChange={vi.fn()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('clicking a tab triggers onValueChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs items={tabItems} value="a" onValueChange={onChange} />);

    await user.click(screen.getByText('Tab B'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('ArrowRight changes active tab to next', () => {
    const onChange = vi.fn();
    render(<Tabs items={tabItems} value="a" onValueChange={onChange} />);

    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('ArrowLeft wraps to last tab from first', () => {
    const onChange = vi.fn();
    render(<Tabs items={tabItems} value="a" onValueChange={onChange} />);

    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });

    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('ArrowRight wraps to first tab from last', () => {
    const onChange = vi.fn();
    render(<Tabs items={tabItems} value="c" onValueChange={onChange} />);

    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('has tablist role with default aria-label', () => {
    render(<Tabs items={tabItems} value="a" onValueChange={vi.fn()} />);

    const tablist = screen.getByRole('tablist');
    expect(tablist).toHaveAttribute('aria-label', 'Tabs');
  });

  it('uses custom ariaLabel when provided', () => {
    render(<Tabs items={tabItems} value="a" onValueChange={vi.fn()} ariaLabel="My tabs" />);

    const tablist = screen.getByRole('tablist');
    expect(tablist).toHaveAttribute('aria-label', 'My tabs');
  });
});
