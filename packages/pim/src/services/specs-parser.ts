type SpecValue = Readonly<{
  value: unknown;
  unit?: string;
}>;

export function normalizeAttributeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function parseExtractedSpecs(
  specsExtracted: Record<string, unknown> | null
): Map<string, SpecValue> {
  if (!specsExtracted) return new Map();

  const result = new Map<string, SpecValue>();
  const topLevelFields = ['title', 'brand', 'mpn', 'gtin', 'category'];

  for (const field of topLevelFields) {
    const value = specsExtracted[field];
    if (value !== null && value !== undefined) {
      result.set(normalizeAttributeName(field), { value });
    }
  }

  const price = specsExtracted['price'];
  if (price && typeof price === 'object') {
    const amount = (price as { amount?: unknown }).amount;
    if (amount !== null && amount !== undefined) {
      result.set('price', { value: amount });
    }
  }

  const specifications = specsExtracted['specifications'];
  if (Array.isArray(specifications)) {
    for (const item of specifications) {
      if (!item || typeof item !== 'object') continue;
      const name = (item as { name?: unknown }).name;
      const value = (item as { value?: unknown }).value;
      const unit = (item as { unit?: unknown }).unit;
      if (typeof name !== 'string' || name.trim() === '') continue;
      if (value === null || value === undefined) continue;
      result.set(normalizeAttributeName(name), {
        value,
        ...(typeof unit === 'string' && unit.trim() ? { unit: unit.trim() } : {}),
      });
    }
  }

  return result;
}
