import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QualityScoreBreakdown } from './QualityScoreBreakdown';

describe('QualityScoreBreakdown', () => {
  it('renders fallback when breakdown is missing', () => {
    render(<QualityScoreBreakdown breakdown={null} score={null} />);

    expect(screen.getByText('No quality breakdown available.')).toBeTruthy();
  });

  it('renders breakdown values', () => {
    render(
      <QualityScoreBreakdown
        score={0.82}
        breakdown={{ completeness: 0.9, accuracy: 0.8, consistency: 0.7, sourceWeight: 0.6 }}
      />
    );

    expect(screen.getByText('Quality score: 82%')).toBeTruthy();
    expect(screen.getByText('Completeness')).toBeTruthy();
    expect(screen.getByText('Accuracy')).toBeTruthy();
    expect(screen.getByText('Consistency')).toBeTruthy();
    expect(screen.getByText('Source weight')).toBeTruthy();
  });
});
