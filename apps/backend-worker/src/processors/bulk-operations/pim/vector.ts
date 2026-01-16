export function toPgVectorLiteral(embedding: readonly number[]): string {
  // pgvector accepts text input like: '[0.1,0.2,...]'
  // We keep full precision to avoid distorting similarity.
  return `[${embedding.map((n) => (Number.isFinite(n) ? String(n) : '0')).join(',')}]`;
}

export function normalizeText(input: string | null | undefined): string {
  return (input ?? '').trim().replace(/\s+/g, ' ');
}
