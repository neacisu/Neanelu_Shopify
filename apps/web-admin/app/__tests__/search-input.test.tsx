import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchInput } from '../components/ui/SearchInput';

interface SearchInputOptionalProps {
  disabled?: boolean;
  loading?: boolean;
  recentSearches?: readonly string[];
  maxSuggestions?: number;
  className?: string;
}

function setup(props?: Partial<React.ComponentProps<typeof SearchInput>>) {
  const onChange = vi.fn();
  const onSelectSuggestion = vi.fn();
  const onSearch = vi.fn();
  const optionalProps: SearchInputOptionalProps = {
    ...(props?.disabled === undefined ? {} : { disabled: props.disabled }),
    ...(props?.loading === undefined ? {} : { loading: props.loading }),
    ...(props?.recentSearches === undefined ? {} : { recentSearches: props.recentSearches }),
    ...(props?.maxSuggestions === undefined ? {} : { maxSuggestions: props.maxSuggestions }),
    ...(props?.className === undefined ? {} : { className: props.className }),
  };

  const renderProps = {
    value: props?.value ?? '',
    onChange: props?.onChange ?? onChange,
    onSearch: props?.onSearch ?? onSearch,
    onSelectSuggestion: props?.onSelectSuggestion ?? onSelectSuggestion,
    label: props?.label ?? 'Search',
    placeholder: props?.placeholder ?? 'Job id',
    debounceMs: props?.debounceMs ?? 0,
    suggestions: props?.suggestions ?? [
      { id: 'a', label: 'alpha', value: 'alpha' },
      { id: 'b', label: 'beta', value: 'beta' },
    ],
    ...optionalProps,
  } satisfies React.ComponentProps<typeof SearchInput>;

  render(<SearchInput {...renderProps} />);

  return { onChange, onSelectSuggestion, onSearch };
}

describe('SearchInput', () => {
  it('renders label and input', () => {
    setup();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Job id')).toBeInTheDocument();
  });

  it('supports keyboard navigation and selection', async () => {
    const user = userEvent.setup();
    const { onChange, onSelectSuggestion, onSearch } = setup({ value: '' });

    const input = screen.getByPlaceholderText('Job id');
    await user.click(input);

    // Type to open/filter suggestions.
    await user.type(input, 'a');

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'alpha' })).toBeInTheDocument();
    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('alpha');
    expect(onSearch).toHaveBeenCalledWith('alpha');
    expect(onSelectSuggestion).toHaveBeenCalledWith('alpha');
  });

  it('debounces typing search calls', () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    setup({ onSearch, debounceMs: 200, value: '', loading: true });

    const input = screen.getByPlaceholderText('Job id');
    // Loading should be expressed via aria-busy.
    expect(input).toHaveAttribute('aria-busy', 'true');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });

    expect(onSearch).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(199);
    expect(onSearch).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(onSearch).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
