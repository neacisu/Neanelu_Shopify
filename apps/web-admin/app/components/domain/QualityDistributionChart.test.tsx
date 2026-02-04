import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QualityDistributionChart } from './QualityDistributionChart';

describe('QualityDistributionChart', () => {
  it('renders donut chart with data', () => {
    const { container } = render(
      <QualityDistributionChart
        total={100}
        distribution={{ bronze: 40, silver: 30, golden: 20, review: 10 }}
      />
    );

    expect(container.querySelector('svg')).toBeTruthy();
  });
});
