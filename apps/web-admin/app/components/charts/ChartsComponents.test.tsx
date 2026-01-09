import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarChart } from './BarChart';
import { DonutChart } from './DonutChart';
import { GaugeChart } from './GaugeChart';
import { LineChart } from './LineChart';
import { Sparkline } from './Sparkline';

describe('Charts components (F3.9.6–F3.9.10)', () => {
  it('LineChart renders with multi-line data', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ x: i, a: i, b: i * 2, c: i * 3 }));
    const { container } = render(
      <LineChart
        data={data}
        xAxisKey="x"
        lines={[
          { dataKey: 'a', name: 'A', areaFill: true },
          { dataKey: 'b', name: 'B' },
          { dataKey: 'c', name: 'C' },
        ]}
        showTooltip
        showLegend
      />
    );

    // Smoke check: recharts primitives render SVG structure.
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('BarChart renders stacked variant', () => {
    const data = [
      { x: 'a', v1: 1, v2: 2 },
      { x: 'b', v1: 3, v2: 4 },
      { x: 'c', v1: 5, v2: 6 },
      { x: 'd', v1: 7, v2: 8 },
      { x: 'e', v1: 9, v2: 10 },
    ];

    const { container } = render(
      <BarChart
        data={data}
        xAxisKey="x"
        stacked
        bars={[
          { dataKey: 'v1', name: 'V1' },
          { dataKey: 'v2', name: 'V2' },
        ]}
      />
    );

    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('DonutChart renders center label', () => {
    const { container } = render(
      <DonutChart
        data={[
          { name: 'A', value: 1 },
          { name: 'B', value: 2 },
          { name: 'C', value: 3 },
          { name: 'D', value: 4 },
          { name: 'E', value: 5 },
          { name: 'F', value: 6 },
          { name: 'G', value: 7 },
          { name: 'H', value: 8 },
        ]}
        centerLabel="42%"
      />
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('Sparkline shows change indicator', () => {
    const { getByLabelText } = render(<Sparkline data={[1, 2, 3]} showChange />);
    expect(getByLabelText('up')).toBeInTheDocument();
  });

  it('GaugeChart applies threshold color and animates needle', () => {
    const { container } = render(
      <GaugeChart
        value={90}
        min={0}
        max={100}
        thresholds={[
          { value: 0, color: '#00ff00' },
          { value: 80, color: '#ff0000' },
        ]}
        showValue
        label="CPU"
      />
    );

    // progress path is the last path in the svg before the needle group
    const paths = container.querySelectorAll('svg path');
    const progressPath = paths[paths.length - 1];
    expect(progressPath).toBeTruthy();
    expect(progressPath?.getAttribute('stroke')).toBe('#ff0000');

    const needleGroup = container.querySelector('svg g');
    expect(needleGroup).toBeTruthy();
    expect(needleGroup?.getAttribute('style') ?? '').toContain('transition: transform 500ms ease');
    // value=90% => angle=-180 + 0.9*180 = -18deg
    expect(needleGroup?.getAttribute('style') ?? '').toContain('rotate(-18deg)');
  });
});
