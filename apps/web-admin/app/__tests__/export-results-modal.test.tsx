import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProductSearchResult } from '@app/types';
import { ExportResultsModal } from '../components/domain/export-results-modal';

describe('ExportResultsModal', () => {
  it('runs async export flow and shows download link', async () => {
    vi.useFakeTimers();

    const onStartAsyncExport = vi.fn().mockResolvedValue({
      jobId: 'job-1',
      status: 'queued',
      progress: 0,
    });
    const onPollAsyncExport = vi
      .fn()
      .mockResolvedValueOnce({ jobId: 'job-1', status: 'processing', progress: 40 })
      .mockResolvedValueOnce({
        jobId: 'job-1',
        status: 'completed',
        progress: 100,
        downloadUrl: '/download/job-1',
      });

    const results: ProductSearchResult[] = [{ id: 'prod-1', title: 'Result', similarity: 0.9 }];

    render(
      <ExportResultsModal
        open
        results={results}
        totalCount={1500}
        onClose={() => undefined}
        onStartAsyncExport={onStartAsyncExport}
        onPollAsyncExport={onPollAsyncExport}
      />
    );

    expect(screen.getByText('Pornește export (1500 rezultate)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Pornește export (1500 rezultate)'));

    expect(onStartAsyncExport).toHaveBeenCalledWith('csv');
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('În coadă')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(onPollAsyncExport).toHaveBeenCalledTimes(1);
    expect(screen.getByText('În curs')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(onPollAsyncExport).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Finalizat')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Descarcă export' })).toHaveAttribute(
      'href',
      '/download/job-1'
    );

    vi.useRealTimers();
  });
});
