import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QueueGovernancePanel } from './QueueGovernancePanel';

describe('QueueGovernancePanel', () => {
  it('renders queues and provider status', () => {
    render(
      <QueueGovernancePanel
        providers={[
          { provider: 'openai', exceeded: false, alertTriggered: true, ratio: 0.85 },
          { provider: 'xai', exceeded: false, alertTriggered: false, ratio: 0.2 },
        ]}
        queues={[
          { queueName: 'pim-enrichment-queue', paused: true },
          { queueName: 'pim-ai-audit', paused: false },
        ]}
      />
    );

    expect(screen.getByText(/Guvernanta cozi cost-sensitive/i)).toBeTruthy();
    expect(screen.getByText(/PIM Enrichment Queue/i)).toBeTruthy();
    expect(screen.getByText(/PIM AI Audit/i)).toBeTruthy();
    expect(screen.getByText(/Pauzata/i)).toBeTruthy();
    expect(screen.getByText(/Activa/i)).toBeTruthy();
  });
});
