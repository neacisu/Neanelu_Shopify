import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { toDlqQueueName } from '../names.js';

void describe('toDlqQueueName', () => {
  void it('appends -dlq to a normal queue name', () => {
    assert.equal(toDlqQueueName('webhook-queue'), 'webhook-queue-dlq');
  });

  void it('keeps existing -dlq suffix', () => {
    assert.equal(toDlqQueueName('webhook-queue-dlq'), 'webhook-queue-dlq');
  });

  void it('throws on empty input', () => {
    assert.throws(() => toDlqQueueName(''), { name: 'Error' });
  });
});
