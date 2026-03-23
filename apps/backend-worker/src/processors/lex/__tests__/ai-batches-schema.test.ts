import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
  lexTranslationAuditEnvelopeSchema,
  lexTranslationBatchItemSchema,
  lexTranslationLlmEnvelopeSchema,
} from '../lex-translation-ai-schemas.js';

const VALID_UUID_V4 = '550e8400-e29b-41d4-a716-446655440000';
const INVALID_UUID = 'not-a-uuid';

await describe('ai-batches – Zod schemas (z.uuid)', () => {
  test('lexTranslationBatchItemSchema accepts RFC UUID clusterId', () => {
    const parsed = lexTranslationBatchItemSchema.safeParse({
      clusterId: VALID_UUID_V4,
      translation: 'surub',
      confidence: 0.9,
    });
    assert.strictEqual(parsed.success, true);
  }).catch((): undefined => undefined);

  test('lexTranslationBatchItemSchema rejects non-UUID clusterId', () => {
    const parsed = lexTranslationBatchItemSchema.safeParse({
      clusterId: INVALID_UUID,
      translation: 'x',
      confidence: 0.5,
    });
    assert.strictEqual(parsed.success, false);
  }).catch((): undefined => undefined);

  test('lexTranslationLlmEnvelopeSchema validates nested items', () => {
    const parsed = lexTranslationLlmEnvelopeSchema.safeParse({
      items: [
        {
          clusterId: VALID_UUID_V4,
          translation: 'a',
          confidence: 0.5,
        },
      ],
    });
    assert.strictEqual(parsed.success, true);
  }).catch((): undefined => undefined);

  test('lexTranslationAuditEnvelopeSchema validates termId and clusterId as UUID', () => {
    const parsed = lexTranslationAuditEnvelopeSchema.safeParse({
      items: [
        {
          termId: VALID_UUID_V4,
          clusterId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          valid: true,
          issues: [],
          consistencyScore: 0.85,
        },
      ],
    });
    assert.strictEqual(parsed.success, true);
  }).catch((): undefined => undefined);

  test('lexTranslationAuditEnvelopeSchema rejects invalid termId', () => {
    const parsed = lexTranslationAuditEnvelopeSchema.safeParse({
      items: [
        {
          termId: INVALID_UUID,
          clusterId: VALID_UUID_V4,
          valid: true,
          issues: [],
          consistencyScore: 1,
        },
      ],
    });
    assert.strictEqual(parsed.success, false);
  }).catch((): undefined => undefined);
});
