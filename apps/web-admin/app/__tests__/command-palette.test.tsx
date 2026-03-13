import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

import { CommandPalette } from '../components/layout/command-palette';

const items = [
  { id: '/', label: 'Panou principal', description: 'Dashboard', to: '/' },
  { id: '/queues', label: 'Cozi', description: 'Monitorizare cozi', to: '/queues' },
  { id: '/ingestion', label: 'Ingestie', description: 'Sincronizare catalog', to: '/ingestion' },
  { id: '/search', label: 'Căutare', description: 'Căutare semantică', to: '/search' },
];

describe('CommandPalette', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders nothing when open=false', () => {
    const { container } = render(<CommandPalette open={false} onClose={vi.fn()} items={items} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders items when open=true', () => {
    render(<CommandPalette open onClose={vi.fn()} items={items} />);
    expect(screen.getByText('Panou principal')).toBeInTheDocument();
    expect(screen.getByText('Cozi')).toBeInTheDocument();
    expect(screen.getByText('Ingestie')).toBeInTheDocument();
    expect(screen.getByText('Căutare')).toBeInTheDocument();
  });

  it('filters results when typing in search input', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} items={items} />);

    const input = screen.getByPlaceholderText('Caută pagini și acțiuni...');
    await user.type(input, 'Cozi');

    expect(screen.getByText('Cozi')).toBeInTheDocument();
    expect(screen.queryByText('Ingestie')).not.toBeInTheDocument();
  });

  it('shows empty message when no results match', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} items={items} />);

    const input = screen.getByPlaceholderText('Caută pagini și acțiuni...');
    await user.type(input, 'xyznonexistent');

    expect(screen.getByText('Nu există rezultate pentru căutarea curentă.')).toBeInTheDocument();
  });

  it('ArrowDown changes highlighted item', () => {
    render(<CommandPalette open onClose={vi.fn()} items={items} />);

    const innerContainer = screen.getByTestId('command-palette-container');

    const firstItem = screen.getByText('Panou principal').closest('button')!;
    expect(firstItem.className).toContain('bg-primary/10');

    fireEvent.keyDown(innerContainer, { key: 'ArrowDown' });

    const secondItem = screen.getByText('Cozi').closest('button')!;
    expect(secondItem.className).toContain('bg-primary/10');
  });

  it('ArrowUp wraps to last item from first', () => {
    render(<CommandPalette open onClose={vi.fn()} items={items} />);

    const innerContainer = screen.getByTestId('command-palette-container');

    fireEvent.keyDown(innerContainer, { key: 'ArrowUp' });

    const lastItem = screen.getByText('Căutare').closest('button')!;
    expect(lastItem.className).toContain('bg-primary/10');
  });

  it('Enter navigates to the selected item and calls onClose', () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} items={items} />);

    const innerContainer = screen.getByTestId('command-palette-container');

    fireEvent.keyDown(innerContainer, { key: 'ArrowDown' });
    fireEvent.keyDown(innerContainer, { key: 'Enter' });

    expect(mockNavigate).toHaveBeenCalledWith('/queues');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the backdrop calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} items={items} />);

    const backdrop = screen.getByRole('dialog');
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });
});
