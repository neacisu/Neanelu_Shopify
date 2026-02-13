import { render, screen } from '@testing-library/react';
import { Flame } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { PromotionRateCard } from '../PromotionRateCard';

describe('PromotionRateCard', () => {
  it('renders value and label', () => {
    render(<PromotionRateCard label="To Golden (24h)" value={5} variant="success" />);
    expect(screen.getByText('To Golden (24h)')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'To Golden (24h): 5' })).toBeTruthy();
  });

  it('applies warning variant and renders custom icon', () => {
    const { container } = render(
      <PromotionRateCard label="Needs Review" value={3} variant="warning" icon={<Flame />} />
    );
    expect(screen.getByText('Needs Review')).toBeTruthy();
    expect(container.querySelector('.border-amber-300\\/80')).toBeTruthy();
  });
});
