import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConsensusDetailDrawer } from './ConsensusDetailDrawer';

describe('ConsensusDetailDrawer', () => {
  it('renders conflicts and votes when data is provided', () => {
    render(
      <ConsensusDetailDrawer
        isOpen
        onClose={() => undefined}
        onRecompute={() => undefined}
        onExport={() => undefined}
        onViewProduct={() => undefined}
        onResolveConflict={() => undefined}
        title="Product One"
        status="conflicts"
        qualityScore={0.88}
        conflictsCount={1}
        breakdown={{
          completeness: 0.9,
          accuracy: 0.85,
          consistency: 0.8,
          sourceWeight: 0.95,
        }}
        sources={[
          {
            sourceName: 'Source One',
            trustScore: 0.9,
            similarityScore: 0.8,
            status: 'confirmed',
          },
        ]}
        results={[
          {
            attribute: 'color',
            value: 'red',
            sourcesCount: 1,
            confidence: 0.88,
          },
        ]}
        conflicts={[
          {
            attributeName: 'color',
            reason: 'Close match',
            values: [
              {
                value: 'red',
                sourceName: 'Source One',
                trustScore: 0.9,
                similarityScore: 0.8,
              },
            ],
          },
        ]}
        provenance={[
          {
            attributeName: 'color',
            sourceName: 'Source One',
            resolvedAt: new Date().toISOString(),
          },
        ]}
        votesByAttribute={{
          color: [
            {
              value: 'red',
              attributeName: 'color',
              sourceName: 'Source One',
              trustScore: 0.9,
              similarityScore: 0.8,
              matchId: 'match-1',
            },
          ],
        }}
      />
    );

    expect(screen.getByText('Product One')).toBeInTheDocument();
    expect(screen.getAllByText('Conflicts').length).toBeGreaterThan(0);
    expect(screen.getByText('Multi-source Voting')).toBeInTheDocument();
    expect(
      screen.getByText('Winner: red (votes: 1, weight: 0.720). Min votes required: 1')
    ).toBeInTheDocument();
  });
});
