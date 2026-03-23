/** Page size for review candidate scans (plan f3-27). */
export const REVIEW_ENQUEUE_PAGE_SIZE = 500;
/** Safety cap: max pages per category per shard to avoid unbounded jobs. */
export const REVIEW_ENQUEUE_MAX_PAGES = 500;

export const REVIEW_ENQUEUE_UUID_ZERO = '00000000-0000-0000-0000-000000000000';

export function chunkLexReviewEnqueueIds<T>(items: readonly T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
