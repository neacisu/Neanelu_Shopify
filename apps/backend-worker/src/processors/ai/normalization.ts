import { normalizeText } from '../bulk-operations/pim/vector.js';

export function normalizeSearchQuery(text: string): string {
  return normalizeText(text).toLowerCase();
}
