import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LexOperationsPanel } from './LexOperationsPanel';

describe('LexOperationsPanel', () => {
  it('renders lexical operational summary and deep links', () => {
    render(
      <LexOperationsPanel
        summary={{
          activeRuns: 3,
          pausedRuns: 2,
          failedShards: 4,
          staleCheckpoints: 1,
          aiBatchBacklog: 8,
          reviewBacklog: 5,
          pendingPublications: 7,
          failedPublications: 2,
          publishConflicts: 3,
          dlqEntries: 6,
          retentionLagSeconds: 7322,
          workersOnline: 11,
          workersTotal: 14,
        }}
        health={{
          score: 61,
          workersOnline: 11,
          workersTotal: 14,
          pausedRuns: 2,
          pausedBudgetBlocked: 1,
          pausedProviderUnavailable: 1,
          staleCheckpoints: 1,
          dlqEntries: 6,
          publicationFailures: 2,
          publishConflicts: 3,
          retentionLagSeconds: 7322,
        }}
      />
    );

    expect(screen.getByText('Operațiuni Lex')).toBeInTheDocument();
    expect(screen.getByText('Lex Degraded')).toBeInTheDocument();
    expect(screen.getByText('Runs active')).toBeInTheDocument();
    expect(screen.getByText('Publish conflicts')).toBeInTheDocument();
    expect(screen.getByText('11/14')).toBeInTheDocument();
    expect(screen.getByText('2h 2m')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Deschide PIM Translations/i })).toHaveAttribute(
      'href',
      '/pim/translations?tab=overview'
    );
    expect(screen.getByRole('link', { name: /Vezi cozi/i })).toHaveAttribute(
      'href',
      '/queues?tab=overview'
    );
  });
});
