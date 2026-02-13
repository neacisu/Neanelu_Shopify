import { createHash } from 'crypto';

export function hashHtmlContent(html: string): string {
  return createHash('sha256').update(html).digest('hex');
}
