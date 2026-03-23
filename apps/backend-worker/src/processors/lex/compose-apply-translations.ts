export type ReplacementRule = Readonly<{
  sourceText: string;
  targetText: string;
  qualityScore: number;
}>;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Applies translation rules in a **single pass** over the original string (one global replace).
 * This avoids sequential cascade bugs (e.g. "racord"→"connector" then "connector"→"fitting" on
 * text that only contained "racord"). Alternation order is longest-source first so "A B" wins over "A".
 */
export function applyTranslations(
  text: string,
  rules: readonly ReplacementRule[]
): {
  text: string;
  matchCount: number;
  qualityTotal: number;
  matchedKeywords: string[];
} {
  if (rules.length === 0) {
    return { text, matchCount: 0, qualityTotal: 0, matchedKeywords: [] };
  }

  const ordered = [...rules].sort(
    (a, b) =>
      b.sourceText.length - a.sourceText.length || a.sourceText.localeCompare(b.sourceText, 'en')
  );

  const ruleByLower = new Map<string, ReplacementRule>();
  for (const rule of ordered) {
    const k = rule.sourceText.toLowerCase();
    if (!ruleByLower.has(k)) ruleByLower.set(k, rule);
  }

  const uniqueByLength = [...ruleByLower.values()].sort(
    (a, b) =>
      b.sourceText.length - a.sourceText.length || a.sourceText.localeCompare(b.sourceText, 'en')
  );

  const alternation = uniqueByLength.map((r) => escapeRegex(r.sourceText)).join('|');
  // \b treats diacritics (ă â î ș ț) as non-word chars, causing false matches
  // inside Romanian words. Use Unicode-aware lookbehind/lookahead instead.
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'giu');

  let matchCount = 0;
  let qualityTotal = 0;
  const matchedKeywords = new Set<string>();

  const output = text.replace(pattern, (match) => {
    const rule = ruleByLower.get(match.toLowerCase());
    if (!rule) return match;
    matchCount += 1;
    qualityTotal += rule.qualityScore;
    matchedKeywords.add(rule.targetText);
    return rule.targetText;
  });

  return {
    text: output,
    matchCount,
    qualityTotal,
    matchedKeywords: [...matchedKeywords],
  };
}
