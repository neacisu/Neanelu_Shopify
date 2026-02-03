import { describe, expect, it } from 'vitest';

import { isValidGTINFormat, normalizeGTIN, validateGTINChecksum } from '../utils/gtin-validator.js';

describe('gtin-validator', () => {
  it('accepta formate GTIN valide', () => {
    expect(isValidGTINFormat('4006381333931')).toBe(true); // EAN-13
    expect(isValidGTINFormat('036000291452')).toBe(true); // UPC-A
    expect(isValidGTINFormat('042100005264')).toBe(true); // UPC-A
    expect(isValidGTINFormat('96385074')).toBe(true); // EAN-8
  });

  it('respinge formate invalide', () => {
    expect(isValidGTINFormat('123')).toBe(false);
    expect(isValidGTINFormat('123456789012345')).toBe(false);
  });

  it('verifica checksum corect', () => {
    expect(validateGTINChecksum('4006381333931')).toBe(true);
    expect(validateGTINChecksum('4006381333932')).toBe(false);
  });

  it('normalizeaza la 14 cifre', () => {
    expect(normalizeGTIN('4006381333931')).toBe('04006381333931');
    expect(normalizeGTIN('4006381333932')).toBeNull();
  });
});
