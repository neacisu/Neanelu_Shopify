import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import PimOverviewPage from '../app.pim._index';

describe('app.pim overview', () => {
  it('renders KPI cards from loader data', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/pim',
          element: <PimOverviewPage />,
          loader: () => ({
            quality: {
              bronze: { count: 4, percentage: 40, avgQualityScore: 0.55 },
              silver: { count: 3, percentage: 30, avgQualityScore: 0.72 },
              golden: { count: 2, percentage: 20, avgQualityScore: 0.91 },
              review: { count: 1, percentage: 10, avgQualityScore: 0.3 },
              total: 10,
              needsReviewCount: 1,
              promotions: { toSilver24h: 2, toGolden24h: 1, toSilver7d: 4, toGolden7d: 2 },
              lastUpdate: '2026-02-04T09:55:00Z',
              refreshedAt: '2026-02-04T10:00:00Z',
            },
            enrichment: {
              pipelineStages: [
                { id: 'pending', name: 'Pending', count: 3, status: 'active', avgDuration: null },
              ],
            },
            sources: {
              sources: [
                {
                  sourceName: 'Supplier A',
                  sourceType: 'SUPPLIER',
                  successRate: 80,
                  trustScore: 0.8,
                  isActive: true,
                },
              ],
              refreshedAt: '2026-02-04T10:00:00Z',
            },
            syncStatus: {
              syncStatus: [
                {
                  dataQualityLevel: 'bronze',
                  channel: 'shopify',
                  productCount: 10,
                  syncedCount: 6,
                  syncRate: 60,
                  avgQualityScore: 0.62,
                },
              ],
              refreshedAt: '2026-02-04T10:00:00Z',
            },
          }),
        },
      ],
      { initialEntries: ['/pim'] }
    );

    render(<RouterProvider router={router} />);
    expect(await screen.findByText('Total produse')).toBeTruthy();
    expect(screen.getAllByText('10').length >= 1).toBeTruthy();
    expect(screen.getByText('Status sincronizare canale')).toBeTruthy();
    const syncRate = screen.getByText('60.0%');
    expect(syncRate.className.includes('text-danger')).toBeTruthy();
  });
});
