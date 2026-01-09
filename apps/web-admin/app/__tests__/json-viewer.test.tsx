import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { JsonViewer } from '../components/ui/JsonViewer';

describe('JsonViewer', () => {
  it('copies stringified JSON', async () => {
    const user = userEvent.setup();

    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<JsonViewer value={{ a: 1 }} copyable />);

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0]?.[0])).toContain('"a": 1');
  });

  it('shows expand toggle when payload is large', async () => {
    const user = userEvent.setup();

    const big = { data: 'x'.repeat(200_000) };
    render(<JsonViewer value={big} collapseThresholdChars={10_000} />);

    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });
});
