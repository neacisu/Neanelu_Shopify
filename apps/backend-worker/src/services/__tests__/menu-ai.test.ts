import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMenuAssignmentQueryText,
  buildMenuItemEmbeddingText,
  isFixedRootMenuItem,
} from '../menu-ai.js';

void describe('menu-ai helpers', () => {
  void it('buildMenuItemEmbeddingText includes path, title, level and parent', () => {
    const text = buildMenuItemEmbeddingText({
      title: 'Robineți',
      path: ['Sisteme de Irigatii', 'Fitinguri', 'Robineți'],
      level: 3,
    });

    assert.equal(
      text,
      'Sisteme de Irigatii > Fitinguri > Robineți | Title: Robineți | Level 3 | Parent: Fitinguri'
    );
  });

  void it('buildMenuAssignmentQueryText concatenates normalized title and disambiguation terms', () => {
    const text = buildMenuAssignmentQueryText({
      normalizedTitleEn: 'Irrigation Valves',
      originalTitle: 'Robineti irigatii',
      domainSummary: 'irrigation hardware',
      disambiguationTerms: ['valves', 'garden watering'],
    });

    assert.equal(
      text,
      'Irrigation Valves | Robineti irigatii | irrigation hardware | valves | garden watering'
    );
  });

  void it('marks fixed level-1 roots as protected', () => {
    assert.equal(
      isFixedRootMenuItem({
        shopifyGid: 'gid://shopify/MenuItem/509623664907',
        level: 1,
      }),
      true
    );
    assert.equal(
      isFixedRootMenuItem({
        shopifyGid: 'gid://shopify/MenuItem/509623664907',
        level: 2,
      }),
      false
    );
  });
});
