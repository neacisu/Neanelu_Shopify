import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { LogEntry } from '../types/log';
import { LogConsole } from '../components/domain/log-console';

describe('LogConsole', () => {
  it('shows empty state when no logs', () => {
    render(<LogConsole logs={[]} />);
    expect(screen.getByText('No logs yet.')).toBeInTheDocument();
  });

  it('filters to errors only when toggled', async () => {
    const user = userEvent.setup();
    const logs: LogEntry[] = [
      {
        id: '1',
        timestamp: '2024-01-01T00:00:00.000Z',
        level: 'info',
        message: 'info message',
      },
      {
        id: '2',
        timestamp: '2024-01-01T00:00:01.000Z',
        level: 'error',
        message: 'error message',
      },
    ];

    render(<LogConsole logs={logs} />);

    expect(screen.getByText('info message')).toBeInTheDocument();
    expect(screen.getByText('error message')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show Errors Only' }));

    expect(screen.queryByText('info message')).not.toBeInTheDocument();
    expect(screen.getByText('error message')).toBeInTheDocument();
  });

  it('opens trace link when trace is clicked', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const logs: LogEntry[] = [
      {
        id: '3',
        timestamp: '2024-01-01T00:00:02.000Z',
        level: 'info',
        message: 'trace message',
        traceId: 'abc123',
      },
    ];

    render(<LogConsole logs={logs} jaegerBaseUrl="https://jaeger.local" />);

    await user.click(screen.getByRole('button', { name: 'trace:abc123' }));

    expect(openSpy).toHaveBeenCalledWith('https://jaeger.local/trace/abc123', '_blank');
    openSpy.mockRestore();
  });
});
