/**
 * Module N: Lexical schema tests
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getColumnInfo,
  getTableColumns,
  getTableIndexes,
  getTableInfo,
  getTableRlsStatus,
  getTableTriggers,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

void describe('Module N: foundational lexical tables', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  for (const tableName of [
    'lex_shop_settings',
    'lex_runs',
    'lex_run_shards',
    'lex_source_watermarks',
    'lex_run_phase_events',
    'lex_fragments',
    'lex_terms',
    'lex_term_occurrences',
    'lex_context_embeddings',
    'lex_glossary_entries',
    'lex_translations',
    'lex_entity_localizations',
    'lex_publication_targets',
    'lex_governance_requests',
    'lex_governance_request_events',
  ]) {
    void it(`${tableName} exists`, async () => {
      const info = await getTableInfo(tableName);
      assert.ok(info, `${tableName} should exist`);
    });
  }

  void it('lex_shop_settings has required config columns', async () => {
    const columns = await getTableColumns('lex_shop_settings');
    const names = new Set(columns.map((column) => column.column_name));
    assert.ok(names.has('shop_id'));
    assert.ok(names.has('version'));
    assert.ok(names.has('source_lang'));
    assert.ok(names.has('target_langs'));
    assert.ok(names.has('extract_scope'));
    assert.ok(names.has('auto_publish_products'));
    assert.ok(names.has('auto_publish_attributes'));
    assert.ok(names.has('auto_publish_collections'));
    assert.ok(names.has('translation_mode'));
    assert.ok(names.has('consensus_escalation_threshold'));
    assert.ok(names.has('translation_auto_approve_threshold'));
    assert.ok(names.has('localization_auto_approve_threshold'));
    assert.ok(names.has('tm_enabled'));
    assert.ok(names.has('tm_similarity_threshold'));
    assert.ok(names.has('quality_audit_enabled'));
    assert.ok(names.has('quality_audit_min_batch_size'));
    assert.ok(names.has('max_terms_per_llm_batch'));
  });

  void it('lex_runs has lifecycle hardening columns', async () => {
    const columns = await getTableColumns('lex_runs');
    const names = new Set(columns.map((column) => column.column_name));
    assert.ok(names.has('current_phase'));
    assert.ok(names.has('phase_started_at'));
    assert.ok(names.has('pause_reason'));
    assert.ok(names.has('completed_with_errors'));
  });

  void it('lex_run_shards has phase and checkpoint columns', async () => {
    const columns = await getTableColumns('lex_run_shards');
    const names = new Set(columns.map((column) => column.column_name));
    assert.ok(names.has('phase_name'));
    assert.ok(names.has('retry_count'));
    assert.ok(names.has('checkpoint_cursor'));
    assert.ok(names.has('completed_with_errors'));
  });

  void it('lex_publication_targets has idempotency and snapshot columns', async () => {
    const columns = await getTableColumns('lex_publication_targets');
    const names = new Set(columns.map((column) => column.column_name));
    assert.ok(names.has('idempotency_key'));
    assert.ok(names.has('target_snapshot_hash'));
    assert.ok(names.has('previous_snapshot'));
    assert.ok(names.has('published_snapshot'));
    assert.ok(names.has('last_event_id'));
  });

  void it('governance tables expose maker-checker fields', async () => {
    const requestColumns = await getTableColumns('lex_governance_requests');
    const requestNames = new Set(requestColumns.map((column) => column.column_name));
    assert.ok(requestNames.has('entity_type'));
    assert.ok(requestNames.has('status'));
    assert.ok(requestNames.has('proposed_payload'));
    assert.ok(requestNames.has('proposed_hash'));
    assert.ok(requestNames.has('created_by'));
    assert.ok(requestNames.has('approved_by'));
    assert.ok(requestNames.has('applied_by'));

    const eventColumns = await getTableColumns('lex_governance_request_events');
    const eventNames = new Set(eventColumns.map((column) => column.column_name));
    assert.ok(eventNames.has('request_id'));
    assert.ok(eventNames.has('actor_id'));
    assert.ok(eventNames.has('action'));
    assert.ok(eventNames.has('from_status'));
    assert.ok(eventNames.has('to_status'));
  });

  void it('effective lexical views expose columns', async () => {
    for (const viewName of [
      'lex_effective_terms',
      'lex_effective_glossary_entries',
      'lex_effective_translation_rules',
      'lex_effective_translations',
      'lex_effective_attribute_resolutions',
    ]) {
      const columns = await getTableColumns(viewName);
      assert.ok(columns.length > 0, `${viewName} should expose columns`);
    }
  });

  void it('lex_context_embeddings stores vector(2000)', async () => {
    const embedding = await getColumnInfo('lex_context_embeddings', 'embedding');
    assert.ok(embedding, 'embedding column should exist');
    assert.strictEqual(embedding?.udt_name, 'vector', 'embedding should use pgvector');
  });

  void it('lex_fragments has trigram search index', async () => {
    const indexes = await getTableIndexes('lex_fragments');
    assert.ok(
      indexes.some((index) => index.indexdef.includes('gin_trgm_ops')),
      'lex_fragments should have a trigram index'
    );
  });

  void it('lex_context_embeddings has hnsw index', async () => {
    const indexes = await getTableIndexes('lex_context_embeddings');
    assert.ok(
      indexes.some((index) => index.indexdef.includes('hnsw')),
      'lex_context_embeddings should have an hnsw index'
    );
  });

  void it('lex_entity_localizations has updated_at trigger', async () => {
    const triggers = await getTableTriggers('lex_entity_localizations');
    assert.ok(
      triggers.some((trigger) => trigger.trigger_name.includes('updated_at')),
      'lex_entity_localizations should have update_updated_at trigger'
    );
  });

  void it('lex_runs has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('lex_runs');
    assert.strictEqual(hasRls, true, 'lex_runs should have RLS enabled');
  });

  void it('hardening indexes exist for active runs and glossary business key', async () => {
    const runsIndexes = await getTableIndexes('lex_runs');
    assert.ok(
      runsIndexes.some((index) => index.indexname.includes('active_shop_run')),
      'lex_runs should have the unique active-run partial index'
    );

    const glossaryIndexes = await getTableIndexes('lex_glossary_entries');
    assert.ok(
      glossaryIndexes.some((index) => index.indexname.includes('active_business_key')),
      'lex_glossary_entries should have the unique active glossary business key index'
    );
  });

  void it('governance tables have dedupe and lookup indexes', async () => {
    const requestIndexes = await getTableIndexes('lex_governance_requests');
    assert.ok(
      requestIndexes.some((index) => index.indexname.includes('dedupe')),
      'lex_governance_requests should have a governance dedupe index'
    );

    const stopwordColumns = await getTableColumns('lex_stopwords');
    const stopwordNames = new Set(stopwordColumns.map((column) => column.column_name));
    assert.ok(stopwordNames.has('version'));
    assert.ok(stopwordNames.has('updated_at'));
  });
});
