import { render, screen } from '@testing-library/react';
import { Flame } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { PromotionRateCard } from '../PromotionRateCard';

describe('PromotionRateCard', () => {
  it('renders value and label', () => {
    render(<PromotionRateCard label="La golden (24h)" value={5} variant="success" />);
    expect(screen.getAllByText('La golden (24h)').length).toBeGreaterThan(0);
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'La golden (24h): 5' })).toBeTruthy();
  });

  it('applies warning variant and renders custom icon', () => {
    const { container } = render(
      <PromotionRateCard label="Necesita review" value={3} variant="warning" icon={<Flame />} />
    );
    expect(screen.getAllByText('Necesita review').length).toBeGreaterThan(0);
    expect(container.querySelector('.border-amber-300\\/80')).toBeTruthy();
  });
});
