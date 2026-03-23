export type TechnicalMatch = Readonly<{
  entityType: string;
  text: string;
  normalizedValue: string | null;
  unit: string | null;
  start: number;
  end: number;
  confidence: number;
}>;

const ENTITY_PATTERNS: readonly {
  entityType: string;
  regex: RegExp;
  normalize?: (value: string) => { normalizedValue: string | null; unit: string | null };
}[] = [
  {
    entityType: 'technical_code',
    regex: /\b(?:DN|PN|IP)\d{1,4}\b/g,
    normalize: (value) => ({ normalizedValue: value.toUpperCase(), unit: null }),
  },
  {
    entityType: 'voltage',
    regex: /\b\d{1,4}\s?V\b/gi,
    normalize: (value) => ({
      normalizedValue: value.replaceAll(/\s+/g, '').toUpperCase(),
      unit: 'V',
    }),
  },
  {
    entityType: 'frequency',
    regex: /\b\d{1,4}\s?Hz\b/gi,
    normalize: (value) => ({
      normalizedValue: value.replaceAll(/\s+/g, '').toUpperCase(),
      unit: 'Hz',
    }),
  },
  {
    entityType: 'fraction',
    regex: /\b\d+\/\d+["”]?\b/g,
    normalize: (value) => ({
      normalizedValue: value.replaceAll(/[”"]/g, '"'),
      unit: '"',
    }),
  },
  {
    entityType: 'measurement',
    regex: /\b\d+(?:[.,]\d+)?\s?(?:mm|cm|m|kg|g|l|ml)\b/gi,
    normalize: (value) => {
      const match = /(\d+(?:[.,]\d+)?)(?:\s?)(mm|cm|m|kg|g|l|ml)/i.exec(value);
      const numericPart = match?.[1] ?? value;
      const unitPart = match?.[2]?.toLowerCase() ?? null;
      return {
        normalizedValue: unitPart ? `${numericPart}${unitPart}` : value,
        unit: unitPart,
      };
    },
  },
  {
    entityType: 'sku_like',
    regex: /\b[A-Z0-9]{3,}(?:-[A-Z0-9]{2,})+\b/g,
    normalize: (value) => ({ normalizedValue: value.toUpperCase(), unit: null }),
  },
] as const;

export function detectTechnicalEntities(text: string): TechnicalMatch[] {
  const matches: TechnicalMatch[] = [];
  for (const pattern of ENTITY_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const value = match[0];
      if (!value) continue;
      const normalized = pattern.normalize?.(value) ?? { normalizedValue: value, unit: null };
      matches.push({
        entityType: pattern.entityType,
        text: value,
        normalizedValue: normalized.normalizedValue,
        unit: normalized.unit,
        start: match.index ?? 0,
        end: (match.index ?? 0) + value.length,
        confidence: 0.99,
      });
    }
  }
  return matches;
}
