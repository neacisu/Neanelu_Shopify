import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProviderComparisonTable } from './ProviderComparisonTable';

describe('ProviderComparisonTable', () => {
  it('renders caption and provider rows', () => {
    render(
      <ProviderComparisonTable
        today={{ serper: 1, xai: 2, openai: 3, total: 6 }}
        thisWeek={{ serper: 4, xai: 5, openai: 6, total: 15 }}
        thisMonth={{ serper: 7, xai: 8, openai: 9, total: 24 }}
      />
    );

    expect(
      screen.getByText(
        'Comparatie costuri API pe furnizori pentru astazi, saptamana si luna curenta.'
      )
    ).toBeTruthy();
    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('Furnizor')).toBeTruthy();
  });
});
