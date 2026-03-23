import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';

const lexQueuesPath = new URL('../../queue/lex-queues.js', import.meta.url).href;

mock.module(lexQueuesPath, {
  namedExports: {
    enqueueLexPublishJob: () => Promise.resolve('mock-queue-job-id'),
  },
});

const { finalLexReviewItemStatus, resolveMergeTermsTargetTermIdFromNewValue } =
  await import('../lex-review-actions.js');

void describe('finalLexReviewItemStatus', () => {
  void test('reject → rejected', () => {
    assert.equal(finalLexReviewItemStatus('reject'), 'rejected');
  });

  void test('approve și acțiunile structurale → approved', () => {
    assert.equal(finalLexReviewItemStatus('approve'), 'approved');
    assert.equal(finalLexReviewItemStatus('merge_terms'), 'approved');
    assert.equal(finalLexReviewItemStatus('split_cluster'), 'approved');
    assert.equal(finalLexReviewItemStatus('lock_translation'), 'approved');
    assert.equal(finalLexReviewItemStatus('publish'), 'approved');
  });

  void test('assign aruncă (rezervat pentru assignLexReviewItem)', () => {
    assert.throws(() => finalLexReviewItemStatus('assign'), /assign_requires_assign_endpoint/);
  });

  void test('tip necunoscut la runtime → mesaj unknown_decision_type', () => {
    assert.throws(
      () => finalLexReviewItemStatus('bogus' as 'approve'),
      /unknown_decision_type:bogus/
    );
  });
});

void describe('resolveMergeTermsTargetTermIdFromNewValue', () => {
  void test('preferă targetTermId când ambele sunt prezente', () => {
    assert.equal(
      resolveMergeTermsTargetTermIdFromNewValue({
        targetTermId: 'a',
        survivorTermId: 'b',
      }),
      'a'
    );
  });

  void test('folosește survivorTermId dacă lipsește targetTermId', () => {
    assert.equal(resolveMergeTermsTargetTermIdFromNewValue({ survivorTermId: 's' }), 's');
  });

  void test('returnează null pentru valori lipsă sau non-string', () => {
    assert.equal(resolveMergeTermsTargetTermIdFromNewValue({}), null);
    assert.equal(resolveMergeTermsTargetTermIdFromNewValue({ targetTermId: 1 }), null);
    assert.equal(resolveMergeTermsTargetTermIdFromNewValue(null), null);
  });
});
