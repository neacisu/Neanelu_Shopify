import { describe, expect, it } from 'vitest';

import {
  buildGovernancePayloadFromDomainProfile,
  buildGovernancePayloadFromGlossary,
  buildGovernancePayloadFromRule,
} from '../lex-governance.js';

describe('buildGovernancePayloadFrom*', () => {
  it('glossary includes senseHint and notes', () => {
    const p = buildGovernancePayloadFromGlossary({
      sourceText: 'a',
      targetText: 'b',
      senseHint: 'hint',
      notes: 'n',
    });
    expect(p['senseHint']).toBe('hint');
    expect(p['notes']).toBe('n');
  });

  it('rule includes neighbor arrays', () => {
    const p = buildGovernancePayloadFromRule({
      ruleName: 'r',
      matchTerm: 'm',
      targetTranslation: 't',
      requiredNeighbors: ['x'],
      forbiddenNeighbors: ['y'],
      requiredFieldKinds: ['title'],
    });
    expect(p['requiredNeighbors']).toEqual(['x']);
    expect(p['forbiddenNeighbors']).toEqual(['y']);
    expect(p['requiredFieldKinds']).toEqual(['title']);
  });

  it('domain profile includes jsonb-shaped fields', () => {
    const p = buildGovernancePayloadFromDomainProfile({
      domainCode: 'dc',
      nameRo: 'ro',
      categoryHints: { a: 1 },
      protectedPatterns: ['p'],
      requiredNeighborTerms: ['r'],
      forbiddenNeighborTerms: ['f'],
      allowedTranslationStyles: ['formal'],
      metadata: { k: 'v' },
    });
    expect(p['categoryHints']).toEqual({ a: 1 });
    expect(p['protectedPatterns']).toEqual(['p']);
    expect(p['requiredNeighborTerms']).toEqual(['r']);
    expect(p['forbiddenNeighborTerms']).toEqual(['f']);
    expect(p['allowedTranslationStyles']).toEqual(['formal']);
    expect(p['metadata']).toEqual({ k: 'v' });
  });
});
