/**
 * Module N: lexical RLS tests
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import { getTablePolicies, getTableRlsStatus } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

const OPERATIONAL_TABLES = [
  'lex_shop_settings',
  'lex_runs',
  'lex_run_shards',
  'lex_checkpoints',
  'lex_source_watermarks',
  'lex_run_phase_events',
  'lex_fragments',
  'lex_fragment_entities',
  'lex_fragment_annotations',
  'lex_term_occurrences',
  'lex_term_stats',
  'lex_term_contexts',
  'lex_context_embeddings',
  'lex_review_items',
  'lex_decisions',
  'lex_entity_localizations',
  'lex_entity_localization_evidence',
  'lex_publication_targets',
  'lex_publish_events',
  'lex_governance_requests',
  'lex_governance_request_events',
];

void describe('Module N RLS: operational tables', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  for (const tableName of OPERATIONAL_TABLES) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });

    void it(`${tableName} has tenant policy`, async () => {
      const policies = await getTablePolicies(tableName);
      assert.ok(
        policies.some((policy) =>
          ['shop_id', 'current_shop_id'].some((term) => policy.qual?.includes(term))
        ),
        `${tableName} should have a shop-scoped tenant policy`
      );
    });
  }
});
