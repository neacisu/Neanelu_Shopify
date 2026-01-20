import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ScheduleForm } from '../components/domain/schedule-form';

describe('ScheduleForm', () => {
  it('submits schedule with daily preset', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ScheduleForm onSubmit={onSubmit} />);

    const timeInput = screen.getByDisplayValue('02:00');
    fireEvent.change(timeInput, { target: { value: '03:30' } });

    await user.click(screen.getByRole('button', { name: 'Save schedule' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        cron: '30 03 * * *',
        enabled: true,
      })
    );
  });
});
