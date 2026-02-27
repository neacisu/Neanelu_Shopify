import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataFreshnessIndicator } from '../DataFreshnessIndicator';

describe('DataFreshnessIndicator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders fallback text when refreshedAt is null', () => {
    render(<DataFreshnessIndicator refreshedAt={null} label="Quality data" />);
    expect(screen.getByText('Quality data actualizat')).toBeTruthy();
    expect(screen.getByText('Niciodată actualizat')).toBeTruthy();
  });

  it('renders recent and old timestamps with relative age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-10T12:00:00Z'));

    const { rerender } = render(
      <DataFreshnessIndicator refreshedAt="2026-02-10T11:40:00Z" label="Quality data" />
    );
    expect(screen.getByText('acum 20 min')).toBeTruthy();

    rerender(<DataFreshnessIndicator refreshedAt="2026-02-10T10:30:00Z" label="Quality data" />);
    expect(screen.getByText('acum 1 h')).toBeTruthy();

    rerender(<DataFreshnessIndicator refreshedAt="2026-02-10T07:00:00Z" label="Quality data" />);
    expect(screen.getByText('acum 5 h')).toBeTruthy();
  });

  it('renders unknown refresh time for invalid date', () => {
    render(<DataFreshnessIndicator refreshedAt="invalid-date" />);
    expect(screen.getByText('Timp necunoscut')).toBeTruthy();
  });
});
