import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConsensusStatusBadge } from './ConsensusStatusBadge';

describe('ConsensusStatusBadge', () => {
  it('renders the computed label', () => {
    render(<ConsensusStatusBadge status="computed" />);

    expect(screen.getByText('Computed')).toBeTruthy();
  });
});
