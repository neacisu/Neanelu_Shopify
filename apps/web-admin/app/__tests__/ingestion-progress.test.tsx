import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IngestionProgress } from '../components/domain/ingestion-progress';

describe('IngestionProgress', () => {
  it('confirms before aborting', async () => {
    const user = userEvent.setup();
    const onAbort = vi.fn();

    render(
      <IngestionProgress currentStep="parse" progress={40} status="running" onAbort={onAbort} />
    );

    await user.click(screen.getByRole('button', { name: 'Oprește' }));

    const dialog = screen.getByRole('dialog', { name: 'Oprești ingestia?' });
    await user.click(within(dialog).getByRole('button', { name: 'Oprește' }));

    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});
