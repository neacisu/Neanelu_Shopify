/* node:test — describe/it returnează promisiuni planificate de runner. */
/* eslint-disable @typescript-eslint/no-floating-promises */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readGlossaryRulesSnapshotHashFromRunMetadata } from '../lex-glossary-rules-snapshot.js';

describe('lex-glossary-rules-snapshot', () => {
  it('readGlossaryRulesSnapshotHashFromRunMetadata returns null for missing/invalid', () => {
    assert.equal(readGlossaryRulesSnapshotHashFromRunMetadata(null), null);
    assert.equal(readGlossaryRulesSnapshotHashFromRunMetadata(undefined), null);
    assert.equal(readGlossaryRulesSnapshotHashFromRunMetadata([]), null);
    assert.equal(readGlossaryRulesSnapshotHashFromRunMetadata({}), null);
    assert.equal(
      readGlossaryRulesSnapshotHashFromRunMetadata({ glossary_rules_snapshot_hash: '' }),
      null
    );
    assert.equal(
      readGlossaryRulesSnapshotHashFromRunMetadata({ glossary_rules_snapshot_hash: '   ' }),
      null
    );
  });

  it('readGlossaryRulesSnapshotHashFromRunMetadata trims string', () => {
    assert.equal(
      readGlossaryRulesSnapshotHashFromRunMetadata({
        glossary_rules_snapshot_hash: '  abcd  ',
      }),
      'abcd'
    );
  });
});
