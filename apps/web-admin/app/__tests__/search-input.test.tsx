import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchInput } from '../components/ui/SearchInput';

function setup(props?: Partial<React.ComponentProps<typeof SearchInput>>) {
  const onChange = vi.fn();
  const onSelectSuggestion = vi.fn();

  render(
    <SearchInput
      value={props?.value ?? ''}
      onChange={props?.onChange ?? onChange}
      onSelectSuggestion={props?.onSelectSuggestion ?? onSelectSuggestion}
      label={props?.label ?? 'Search'}
      placeholder={props?.placeholder ?? 'Job id'}
      openOnFocus={props?.openOnFocus ?? true}
      debounceMs={props?.debounceMs ?? 0}
      suggestions={
        props?.suggestions ?? [
          { id: 'a', label: 'alpha', value: 'alpha' },
          { id: 'b', label: 'beta', value: 'beta' },
        ]
      }
    />
  );

  return { onChange, onSelectSuggestion };
}

describe('SearchInput', () => {
  it('renders label and input', () => {
    setup();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Job id')).toBeInTheDocument();
  });

  it('supports keyboard navigation and selection', async () => {
    const user = userEvent.setup();
    const { onChange, onSelectSuggestion } = setup({ value: '' });

    const input = screen.getByPlaceholderText('Job id');
    await user.click(input);

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith('alpha');
    expect(onSelectSuggestion).toHaveBeenCalledWith('alpha');
  });

  it('debounces typing changes', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    setup({ onChange, debounceMs: 200, value: '' });

    const input = screen.getByPlaceholderText('Job id');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });

    expect(onChange).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(199);
    expect(onChange).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
