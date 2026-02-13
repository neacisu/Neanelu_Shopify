import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import PimLayout from '../app.pim';

describe('app.pim layout', () => {
  it('renders tabs and navigates between child routes', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/pim',
          element: <PimLayout />,
          children: [
            { index: true, element: <div>overview-content</div> },
            { path: 'quality', element: <div>quality-content</div> },
            { path: 'enrichment', element: <div>enrichment-content</div> },
            { path: 'costs', element: <div>costs-content</div> },
            { path: 'events', element: <div>events-content</div> },
            { path: 'consensus', element: <div>consensus-content</div> },
          ],
        },
      ],
      { initialEntries: ['/pim'] }
    );

    render(<RouterProvider router={router} />);
    expect(screen.getByText('overview-content')).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'PIM sections' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Quality' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Enrichment' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Costs' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Events' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Consensus' })).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: 'Quality' }));
    expect(await screen.findByText('quality-content')).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: 'Enrichment' }));
    expect(await screen.findByText('enrichment-content')).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: 'Costs' }));
    expect(await screen.findByText('costs-content')).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: 'Events' }));
    expect(await screen.findByText('events-content')).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: 'Consensus' }));
    expect(await screen.findByText('consensus-content')).toBeTruthy();
  });
});
