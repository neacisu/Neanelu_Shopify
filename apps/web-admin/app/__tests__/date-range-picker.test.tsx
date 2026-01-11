import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DateRangePicker } from '../components/ui/DateRangePicker';
import { toUtcIsoRange } from '../utils/date-range';

describe('DateRangePicker', () => {
  it('opens and applies a preset', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    const presets = [
      {
        id: 'last7',
        label: 'Last 7 days',
        range: {
          from: new Date('2026-01-05T00:00:00.000Z'),
          to: new Date('2026-01-11T00:00:00.000Z'),
        },
      },
    ] as const;

    render(
      <DateRangePicker
        label="Date range"
        value={undefined}
        onChange={onChange}
        timeZone="Europe/Bucharest"
        presets={presets}
      />
    );

    const trigger = screen.getByRole('button', { name: /select range/i });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Date range' })).toBeInTheDocument();

    // Focus should move inside the popup.
    expect(await screen.findByRole('button', { name: 'Last 7 days' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Last 7 days' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DateRangePicker label="Date range" value={undefined} onChange={onChange} presets={[]} />
    );

    const trigger = screen.getByRole('button', { name: /select range/i });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Date range' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Date range' })).not.toBeInTheDocument()
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('converts selected range to UTC ISO boundaries', () => {
    const range = {
      from: new Date('2026-01-10T12:00:00.000Z'),
      to: new Date('2026-01-11T12:00:00.000Z'),
    };

    const out = toUtcIsoRange(range, 'Europe/Bucharest');
    expect(out).toBeTruthy();

    // Basic sanity: ISO strings + ordering.
    expect(typeof out?.fromUtcIso).toBe('string');
    expect(typeof out?.toUtcIso).toBe('string');
    expect(new Date(out!.fromUtcIso).getTime()).toBeLessThanOrEqual(
      new Date(out!.toUtcIso).getTime()
    );
  });
});
