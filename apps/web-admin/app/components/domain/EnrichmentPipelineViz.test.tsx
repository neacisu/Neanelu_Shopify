import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EnrichmentPipelineViz } from './EnrichmentPipelineViz';

describe('EnrichmentPipelineViz', () => {
  it('renders stages with counts', () => {
    render(
      <EnrichmentPipelineViz
        stages={[
          { id: 'pending', name: 'Pending', count: 3, status: 'active', avgDuration: 0 },
          { id: 'search', name: 'Search', count: 5, status: 'active', avgDuration: 2 },
        ]}
      />
    );

    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('Search')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });
});
