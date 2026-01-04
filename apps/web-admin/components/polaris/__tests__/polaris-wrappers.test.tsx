import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PolarisButton } from '../button';
import { PolarisCard } from '../card';

describe('Polaris React wrappers', () => {
  it('renders custom elements', () => {
    const { container } = render(
      <PolarisCard>
        <PolarisButton>Click</PolarisButton>
      </PolarisCard>
    );

    expect(container.querySelector('polaris-card')).toBeTruthy();
    expect(container.querySelector('polaris-button')).toBeTruthy();
  });
});
