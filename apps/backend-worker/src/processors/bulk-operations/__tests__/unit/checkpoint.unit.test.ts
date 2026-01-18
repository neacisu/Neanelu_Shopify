import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readIngestCheckpoint } from '../../pipeline/checkpoint.js';

void describe('bulk checkpoint: readIngestCheckpoint', () => {
  void it('parses v2 checkpoints and normalizes counters', () => {
    const checkpoint = readIngestCheckpoint({
      ingest: {
        checkpoint: {
          version: 2,
          committedRecords: 12.7,
          committedProducts: 5,
          committedVariants: 7,
          committedBytes: 1024.9,
          committedLines: 12,
          lastSuccessfulId: 'gid://shopify/Product/1',
          lastCommitAtIso: '2025-01-01T00:00:00Z',
          isFullSnapshot: true,
        },
      },
    });

    assert.equal(checkpoint?.version, 2);
    assert.equal(checkpoint?.committedRecords, 12);
    assert.equal(checkpoint?.committedBytes, 1024);
    assert.equal(checkpoint?.isFullSnapshot, true);
  });

  void it('parses v1 checkpoints and ignores v2-only fields', () => {
    const checkpoint = readIngestCheckpoint({
      ingest: {
        checkpoint: {
          version: 1,
          committedRecords: 2,
          committedProducts: 1,
          committedVariants: 1,
          lastCommitAtIso: '2025-01-01T00:00:00Z',
          isFullSnapshot: false,
          committedBytes: 999,
        },
      },
    });

    assert.equal(checkpoint?.version, 1);
    assert.equal(checkpoint?.committedRecords, 2);
    assert.equal('committedBytes' in (checkpoint ?? {}), false);
  });

  void it('returns null for invalid shapes', () => {
    assert.equal(readIngestCheckpoint(null), null);
    assert.equal(readIngestCheckpoint({ ingest: {} }), null);
    assert.equal(
      readIngestCheckpoint({
        ingest: { checkpoint: { version: 2, committedRecords: 'nope' } },
      }),
      null
    );
  });
});
