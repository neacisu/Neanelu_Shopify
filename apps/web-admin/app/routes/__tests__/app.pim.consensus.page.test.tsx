import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import PimConsensusPage from '../app.pim.consensus';

vi.mock('../../hooks/use-consensus-stats', () => ({
  useConsensusStats: () => ({
    data: {
      productsWithConsensus: 10,
      pendingConsensus: 2,
      productsWithConflicts: 1,
      resolvedToday: 0,
      avgSourcesPerProduct: 2,
      avgQualityScore: 0.7,
    },
    loading: false,
    error: null,
    run: () => Promise.resolve(),
  }),
}));

vi.mock('../../hooks/use-consensus-products', () => ({
  useConsensusProducts: () => ({
    data: { items: [], total: 0 },
    loading: false,
    error: null,
    run: () => Promise.resolve(),
  }),
}));

vi.mock('../../hooks/use-consensus-stream', () => ({
  useConsensusStream: () => ({
    connected: true,
    events: [],
  }),
}));

vi.mock('../../hooks/use-api', () => ({
  useApiClient: () => ({
    getApi: () => Promise.resolve({}),
  }),
}));

describe('PIM consensus page', () => {
  it('renders localized sections and controls', async () => {
    const router = createMemoryRouter([{ path: '/pim/consensus', element: <PimConsensusPage /> }], {
      initialEntries: ['/pim/consensus'],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('button', { name: 'Reincarca' })).toBeTruthy();
    expect(screen.getByText('Evenimente consensus in timp real')).toBeTruthy();
    expect(screen.getByText('Distributie conflicte')).toBeTruthy();
    expect(screen.getByText('Toate produsele')).toBeTruthy();
    expect(screen.getAllByText('In asteptare').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Conflicte').length).toBeGreaterThan(0);
  });
});
