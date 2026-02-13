import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import SettingsWebhooksPage from '../routes/settings.webhooks';

const mocks = {
  updateConfig: vi.fn(() => Promise.resolve({})),
  testWebhook: vi.fn(() => Promise.resolve({ ok: true, httpStatus: 200, responseTime: 12 })),
  retryDelivery: vi.fn(() => Promise.resolve({ queued: true, jobId: 'job-1' })),
};

vi.mock('sonner', () => ({
  toast: {
    success: () => undefined,
    error: () => undefined,
  },
}));

vi.mock('../hooks/use-quality-webhook-config', () => ({
  useQualityWebhookConfig: () => ({
    config: {
      url: 'https://example.com/webhook',
      enabled: true,
      subscribedEvents: ['quality_promoted'],
      secretMasked: '***...abcd',
    },
    deliveries: [
      {
        id: 'd-1',
        eventId: 'e-1',
        eventType: 'quality_promoted',
        httpStatus: 500,
        durationMs: 30,
        attempt: 1,
        responseBody: '{"ok":false}',
        errorMessage: 'failed',
        createdAt: new Date().toISOString(),
      },
    ],
    hasMoreDeliveries: false,
    loadMoreDeliveries: vi.fn(),
    isLoading: false,
    updateConfig: mocks.updateConfig,
    testWebhook: mocks.testWebhook,
    retryDelivery: mocks.retryDelivery,
  }),
}));

describe('settings webhooks page', () => {
  it('renders config sections and triggers test', async () => {
    const user = userEvent.setup();
    render(<SettingsWebhooksPage />);

    expect(screen.getByText(/Webhook configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/Test webhook/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Send test/i }));
    expect(mocks.testWebhook).toHaveBeenCalled();
  });
});
