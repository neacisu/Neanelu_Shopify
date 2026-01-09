import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChartContainer } from '../components/charts/ChartContainer';

describe('ChartContainer', () => {
  it('renders title and loading state', () => {
    render(
      <ChartContainer title="Demo" loading>
        <div>Chart</div>
      </ChartContainer>
    );

    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
