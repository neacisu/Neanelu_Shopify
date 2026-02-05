import { describe, expect, it } from 'vitest';

import { parseExtractedSpecs } from '../services/specs-parser.js';

describe('specs-parser', () => {
  it('parsează corect câmpurile top-level și specificațiile', () => {
    const result = parseExtractedSpecs({
      title: 'Produs Test',
      brand: 'Brand Test',
      mpn: 'MPN-1',
      gtin: '1234567890123',
      category: 'Categorie',
      specifications: [
        { name: 'Putere', value: '100W', unit: 'W' },
        { name: 'Culoare', value: 'Negru' },
      ],
      price: { amount: 199.99, currency: 'RON', isPromotional: false },
    });

    expect(result.get('title')?.value).toBe('Produs Test');
    expect(result.get('brand')?.value).toBe('Brand Test');
    expect(result.get('mpn')?.value).toBe('MPN-1');
    expect(result.get('gtin')?.value).toBe('1234567890123');
    expect(result.get('category')?.value).toBe('Categorie');
    expect(result.get('putere')?.value).toBe('100W');
    expect(result.get('putere')?.unit).toBe('W');
    expect(result.get('culoare')?.value).toBe('Negru');
    expect(result.get('price')?.value).toBe(199.99);
  });
});
