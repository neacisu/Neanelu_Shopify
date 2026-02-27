import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Sparkline } from '../components/charts/Sparkline';

describe('Sparkline – trend arrows', () => {
  it('shows green ▲ arrow for upward trend data', () => {
    render(<Sparkline data={[10, 20, 30, 40, 50]} showChange />);
    const arrow = screen.getByTitle('creștere');
    expect(arrow).toBeInTheDocument();
    expect(arrow).toHaveStyle({ color: '#16a34a' });
    expect(arrow.textContent).toContain('▲');
  });

  it('shows red ▼ arrow for downward trend data', () => {
    render(<Sparkline data={[50, 40, 30, 20, 10]} showChange />);
    const arrow = screen.getByTitle('scădere');
    expect(arrow).toBeInTheDocument();
    expect(arrow).toHaveStyle({ color: '#dc2626' });
    expect(arrow.textContent).toContain('▼');
  });

  it('shows gray — for flat data', () => {
    render(<Sparkline data={[30, 30, 30, 30, 30]} showChange />);
    const arrow = screen.getByTitle('constant');
    expect(arrow).toBeInTheDocument();
    expect(arrow).toHaveStyle({ color: '#64748b' });
    expect(arrow.textContent).toContain('—');
  });

  it('does not show change indicator when showChange=false', () => {
    render(<Sparkline data={[10, 20, 30]} showChange={false} />);
    expect(screen.queryByTitle('creștere')).not.toBeInTheDocument();
    expect(screen.queryByTitle('scădere')).not.toBeInTheDocument();
    expect(screen.queryByTitle('constant')).not.toBeInTheDocument();
  });

  it('renders AreaChart when areaFill=true (default)', () => {
    const { container } = render(<Sparkline data={[10, 20, 30]} areaFill />);
    const gradientDef = container.querySelector('linearGradient');
    expect(gradientDef).toBeInTheDocument();
  });

  it('renders LineChart (no area gradient) when areaFill=false', () => {
    const { container } = render(<Sparkline data={[10, 20, 30]} areaFill={false} />);
    const gradientDef = container.querySelector('linearGradient');
    expect(gradientDef).not.toBeInTheDocument();
  });

  it('respects explicit trend prop override', () => {
    render(<Sparkline data={[10, 20, 30]} trend="down" showChange />);
    const arrow = screen.getByTitle('scădere');
    expect(arrow).toBeInTheDocument();
    expect(arrow.textContent).toContain('▼');
  });

  it('displays delta value in the change indicator', () => {
    render(<Sparkline data={[10, 20, 30, 40, 50]} showChange />);
    const arrow = screen.getByTitle('creștere');
    expect(arrow.textContent).toContain('40');
  });
});
