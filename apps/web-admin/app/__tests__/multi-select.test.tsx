import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { MultiSelect, type MultiSelectOption } from '../components/ui/MultiSelect';

const OPTIONS: MultiSelectOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function Harness() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <div>
      <MultiSelect
        label="Tags"
        placeholder="Pick tags"
        options={OPTIONS}
        value={value}
        onChange={setValue}
      />
      <div data-testid="value">{value.join(',')}</div>
    </div>
  );
}

describe('MultiSelect', () => {
  it('selects options and renders tags', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Tags'));
    await user.click(screen.getByRole('option', { name: 'Alpha' }));

    expect(screen.getByTestId('value').textContent).toBe('a');
    expect(screen.getByRole('button', { name: 'Remove Alpha' })).toBeInTheDocument();
  });

  it('filters options by typing', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText('Tags');
    await user.click(input);
    await user.type(input, 'ga');

    expect(screen.getByRole('option', { name: 'Gamma' })).toBeInTheDocument();
  });

  it('removes the last tag with backspace when query is empty', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText('Tags');
    await user.click(input);
    await user.click(screen.getByRole('option', { name: 'Alpha' }));

    await user.click(input);
    await user.keyboard('{Backspace}');

    expect(screen.getByTestId('value').textContent).toBe('');
  });
});
