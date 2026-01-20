import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IngestionHistoryTable } from '../components/domain/ingestion-history-table';

const runs = [
  {
    id: 'run-1',
    status: 'failed',
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:01:00.000Z',
    recordsProcessed: 12,
    errorCount: 2,
  },
  {
    id: 'run-2',
    status: 'completed',
    startedAt: '2024-01-02T00:00:00.000Z',
    completedAt: '2024-01-02T00:02:00.000Z',
    recordsProcessed: 20,
    errorCount: 0,
  },
] as const;

describe('IngestionHistoryTable', () => {
  it('renders runs and supports pagination + sorting + filtering', () => {
    const onStatusChange = vi.fn();
    const onSortChange = vi.fn();
    const onPageChange = vi.fn();
    const onToggleErrors = vi.fn();
    const onRetry = vi.fn();
    const onViewLogs = vi.fn();

    render(
      <IngestionHistoryTable
        runs={[...runs]}
        total={40}
        page={0}
        limit={20}
        statusFilter="all"
        sortKey="startedAt"
        sortDir="desc"
        onStatusChange={onStatusChange}
        onSortChange={onSortChange}
        onPageChange={onPageChange}
        onToggleErrors={onToggleErrors}
        onRetry={onRetry}
        onViewLogs={onViewLogs}
      />
    );

    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();

    const statusSelect = document.querySelector('polaris-select[label="Status"]');
    if (!statusSelect) throw new Error('Missing status select');
    Object.defineProperty(statusSelect, 'value', { value: 'failed', configurable: true });
    fireEvent(statusSelect, new Event('change', { bubbles: true }));
    expect(onStatusChange).toHaveBeenCalledWith('failed');

    fireEvent.click(screen.getByRole('button', { name: /Start/i }));
    expect(onSortChange).toHaveBeenCalledWith('startedAt');

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
