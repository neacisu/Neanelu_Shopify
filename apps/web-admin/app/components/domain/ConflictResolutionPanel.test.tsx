import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConflictResolutionPanel } from './ConflictResolutionPanel';

describe('ConflictResolutionPanel', () => {
  it('calls onSelect when selecting a winner', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <ConflictResolutionPanel
        attributeName="brand"
        options={[
          {
            label: 'Brand A',
            value: 'Brand A',
            weight: 0.42,
            sourcesCount: 2,
            trustAvg: 0.7,
          },
          {
            label: 'Brand B',
            value: 'Brand B',
            weight: 0.35,
            sourcesCount: 3,
            trustAvg: 0.65,
          },
        ]}
        onSelect={onSelect}
      />
    );

    const firstButton = screen.getAllByText('Select winner').at(0);
    if (!firstButton) {
      throw new Error('missing_select_winner_button');
    }
    await user.click(firstButton);

    expect(onSelect).toHaveBeenCalledWith('Brand A');
  });
});
