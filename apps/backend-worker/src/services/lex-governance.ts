import { createHash } from 'node:crypto';

import { withTenantContext } from '@app/database';
import type {
  LexDomainProfileDto,
  LexGovernanceEntityType,
  LexGovernanceRequestDto,
  LexGlossaryEntryDto,
  LexGovernanceStatus,
  LexStopwordDto,
  LexTranslationRuleDto,
} from '@app/types';

interface TenantClient {
  query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ) => Promise<{ rows: TRow[] }>;
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function toJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function trimString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

async function recordGovernanceEvent(params: {
  client: TenantClient;
  requestId: string;
  shopId: string;
  actorId: string | null;
  action: 'create' | 'update' | 'submit' | 'approve' | 'reject' | 'apply' | 'cancel';
  fromStatus: string | null;
  toStatus: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  await params.client.query(
    `INSERT INTO lex_governance_request_events
       (request_id, shop_id, actor_id, action, from_status, to_status, details, created_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7::jsonb, now())`,
    [
      params.requestId,
      params.shopId,
      params.actorId,
      params.action,
      params.fromStatus,
      params.toStatus,
      JSON.stringify(params.details ?? {}),
    ]
  );
}

async function applyCanonicalPayload(params: {
  client: TenantClient;
  entityType: LexGovernanceEntityType;
  targetId: string | null;
  payload: Record<string, unknown>;
  actorId: string | null;
}): Promise<{ resourceType: string; resourceId: string | null }> {
  const payload = params.payload;

  if (params.entityType === 'glossary_entry') {
    const result = await params.client.query<{ id: string }>(
      `INSERT INTO lex_glossary_entries
         (shop_id, domain_code, source_lang, target_lang, source_text, normalized_source_text,
          sense_hint, target_text, translation_kind, priority, version, is_locked, is_active,
          source, confidence_score, notes, approved_by, created_at, updated_at)
       VALUES
         (NULL, $1, $2, $3, $4, lower($4), $5, $6, $7, $8, 1, $9, $10, 'governance', '1.0', $11, $12, now(), now())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        trimString(payload['domainCode'], '') || null,
        trimString(payload['sourceLang'], 'ro'),
        trimString(payload['targetLang'], 'en'),
        trimString(payload['sourceText']),
        trimString(payload['senseHint'], '') || null,
        trimString(payload['targetText']),
        trimString(payload['translationKind'], 'canonical'),
        Math.max(1, Math.min(1000, toNumber(payload['priority'], 100))),
        payload['isLocked'] === true,
        payload['isActive'] !== false,
        trimString(payload['notes'], '') || null,
        params.actorId,
      ]
    );

    return { resourceType: 'lex_glossary_entries', resourceId: result.rows[0]?.id ?? null };
  }

  if (params.entityType === 'translation_rule') {
    const result = await params.client.query<{ id: string }>(
      `INSERT INTO lex_translation_rules
         (shop_id, rule_name, source_lang, target_lang, match_term, domain_code,
          required_neighbors, forbidden_neighbors, required_field_kinds, target_translation,
          priority, version, is_active, created_by, created_at, updated_at)
       VALUES
         (NULL, $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, 1, $11, $12, now(), now())
       RETURNING id`,
      [
        trimString(payload['ruleName']),
        trimString(payload['sourceLang'], 'ro'),
        trimString(payload['targetLang'], 'en'),
        trimString(payload['matchTerm']),
        trimString(payload['domainCode'], '') || null,
        JSON.stringify(
          Array.isArray(payload['requiredNeighbors']) ? payload['requiredNeighbors'] : []
        ),
        JSON.stringify(
          Array.isArray(payload['forbiddenNeighbors']) ? payload['forbiddenNeighbors'] : []
        ),
        JSON.stringify(
          Array.isArray(payload['requiredFieldKinds']) ? payload['requiredFieldKinds'] : []
        ),
        trimString(payload['targetTranslation']),
        Math.max(1, Math.min(1000, toNumber(payload['priority'], 100))),
        payload['isActive'] !== false,
        params.actorId,
      ]
    );

    return { resourceType: 'lex_translation_rules', resourceId: result.rows[0]?.id ?? null };
  }

  if (params.entityType === 'domain_profile') {
    const result = await params.client.query<{ id: string }>(
      `INSERT INTO lex_domain_profiles
         (shop_id, domain_code, name_ro, name_en, description, category_hints, protected_patterns,
          required_neighbor_terms, forbidden_neighbor_terms, allowed_translation_styles, metadata,
          version, is_active, created_at, updated_at)
       VALUES
         (NULL, $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, 1, $11, now(), now())
       RETURNING id`,
      [
        trimString(payload['domainCode']),
        trimString(payload['nameRo']),
        trimString(payload['nameEn'], '') || null,
        trimString(payload['description'], '') || null,
        JSON.stringify(toJsonObject(payload['categoryHints'])),
        JSON.stringify(
          Array.isArray(payload['protectedPatterns']) ? payload['protectedPatterns'] : []
        ),
        JSON.stringify(
          Array.isArray(payload['requiredNeighborTerms']) ? payload['requiredNeighborTerms'] : []
        ),
        JSON.stringify(
          Array.isArray(payload['forbiddenNeighborTerms']) ? payload['forbiddenNeighborTerms'] : []
        ),
        JSON.stringify(
          Array.isArray(payload['allowedTranslationStyles'])
            ? payload['allowedTranslationStyles']
            : []
        ),
        JSON.stringify(toJsonObject(payload['metadata'])),
        payload['isActive'] !== false,
      ]
    );

    return { resourceType: 'lex_domain_profiles', resourceId: result.rows[0]?.id ?? null };
  }

  if (params.entityType === 'stopword') {
    const result = await params.client.query<{ id: string }>(
      `INSERT INTO lex_stopwords
         (shop_id, locale, word, word_type, priority, version, is_active, created_at, updated_at)
       VALUES
         (NULL, $1, $2, $3, $4, 1, $5, now(), now())
       RETURNING id`,
      [
        trimString(payload['locale'], 'ro'),
        trimString(payload['word']),
        trimString(payload['wordType'], 'noise'),
        Math.max(1, Math.min(1000, toNumber(payload['priority'], 100))),
        payload['isActive'] !== false,
      ]
    );

    return { resourceType: 'lex_stopwords', resourceId: result.rows[0]?.id ?? null };
  }

  if (params.entityType === 'locked_translation') {
    if (!params.targetId) {
      throw new Error('governance_locked_translation_requires_target');
    }

    await params.client.query(
      `UPDATE lex_translations
       SET is_locked = true,
           locked_by = $2,
           locked_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [params.targetId, params.actorId]
    );

    return { resourceType: 'lex_translations', resourceId: params.targetId };
  }

  if (params.entityType === 'attribute_resolution') {
    const result = await params.client.query<{ id: string }>(
      `INSERT INTO lex_attribute_resolutions
         (shop_id, term_id, cluster_id, definition_id, resolution_role, version, confidence_score,
          status, approved_by, approved_at, metadata, created_at, updated_at)
       VALUES
         (NULL, $1, $2, $3, $4, 1, $5, 'approved', $6, now(), $7::jsonb, now(), now())
       RETURNING id`,
      [
        trimString(payload['termId']),
        trimString(payload['clusterId'], '') || null,
        trimString(payload['definitionId']),
        trimString(payload['resolutionRole'], 'attribute_label'),
        toNumber(payload['confidenceScore'], 0.99).toFixed(4),
        params.actorId,
        JSON.stringify(toJsonObject(payload['metadata'])),
      ]
    );

    return { resourceType: 'lex_attribute_resolutions', resourceId: result.rows[0]?.id ?? null };
  }

  throw new Error(`unsupported_governance_entity:${params.entityType as string}`);
}

export async function listLexGovernanceRequests(params: {
  shopId: string;
  status?: string | null;
}): Promise<LexGovernanceRequestDto[]> {
  return await withTenantContext(params.shopId, async (client) => {
    const result = await client.query<{
      id: string;
      entityType: string;
      requestScope: string;
      targetId: string | null;
      title: string | null;
      version: number;
      status: string;
      proposedPayload: Record<string, unknown> | null;
      proposedHash: string;
      notes: string | null;
      rejectionReason: string | null;
      createdAt: string | null;
      submittedAt: string | null;
      approvedAt: string | null;
      appliedAt: string | null;
    }>(
      `SELECT
         id,
         entity_type AS "entityType",
         request_scope AS "requestScope",
         target_id AS "targetId",
         title,
         version,
         status,
         proposed_payload AS "proposedPayload",
         proposed_hash AS "proposedHash",
         notes,
         rejection_reason AS "rejectionReason",
         created_at::text AS "createdAt",
         submitted_at::text AS "submittedAt",
         approved_at::text AS "approvedAt",
         applied_at::text AS "appliedAt"
       FROM lex_governance_requests
       WHERE shop_id = $1
         AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at DESC
       LIMIT 200`,
      [params.shopId, params.status ?? null]
    );

    return result.rows.map((row) => ({
      ...row,
      proposedPayload: row.proposedPayload ?? {},
    }));
  });
}

export async function getLexGovernanceRequest(params: {
  shopId: string;
  requestId: string;
}): Promise<LexGovernanceRequestDto | null> {
  return await withTenantContext(params.shopId, async (client) => {
    const result = await client.query<{
      id: string;
      entityType: string;
      requestScope: string;
      targetId: string | null;
      title: string | null;
      version: number;
      status: string;
      proposedPayload: Record<string, unknown> | null;
      proposedHash: string;
      notes: string | null;
      rejectionReason: string | null;
      createdAt: string | null;
      submittedAt: string | null;
      approvedAt: string | null;
      appliedAt: string | null;
    }>(
      `SELECT
         id,
         entity_type AS "entityType",
         request_scope AS "requestScope",
         target_id AS "targetId",
         title,
         version,
         status,
         proposed_payload AS "proposedPayload",
         proposed_hash AS "proposedHash",
         notes,
         rejection_reason AS "rejectionReason",
         created_at::text AS "createdAt",
         submitted_at::text AS "submittedAt",
         approved_at::text AS "approvedAt",
         applied_at::text AS "appliedAt"
       FROM lex_governance_requests
       WHERE id = $1
         AND shop_id = $2
       LIMIT 1`,
      [params.requestId, params.shopId]
    );

    const row = result.rows[0];
    if (!row) return null;
    return { ...row, proposedPayload: row.proposedPayload ?? {} };
  });
}

export async function createLexGovernanceRequest(params: {
  shopId: string;
  entityType: LexGovernanceEntityType;
  targetId?: string | null;
  payload: Record<string, unknown>;
  title?: string | null;
  notes?: string | null;
  actorId: string | null;
}): Promise<{ id: string; version: number; status: LexGovernanceStatus }> {
  return await withTenantContext(params.shopId, async (client) => {
    await client.query('BEGIN');
    try {
      const proposedHash = sha256Json(params.payload);
      const result = await client.query<{
        id: string;
        version: number;
        status: LexGovernanceStatus;
      }>(
        `INSERT INTO lex_governance_requests
           (shop_id, entity_type, request_scope, target_id, title, version, status, proposed_payload,
            proposed_hash, created_by, notes, created_at, updated_at)
         VALUES
           ($1, $2, 'global', $3, $4, 1, 'draft', $5::jsonb, $6, $7, $8, now(), now())
         RETURNING id, version, status`,
        [
          params.shopId,
          params.entityType,
          params.targetId ?? null,
          params.title ?? null,
          JSON.stringify(params.payload),
          proposedHash,
          params.actorId,
          params.notes ?? null,
        ]
      );

      const row = result.rows[0]!;
      await recordGovernanceEvent({
        client,
        requestId: row.id,
        shopId: params.shopId,
        actorId: params.actorId,
        action: 'create',
        fromStatus: null,
        toStatus: row.status,
        details: { entityType: params.entityType, proposedHash },
      });
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function transitionRequest(params: {
  shopId: string;
  requestId: string;
  actorId: string | null;
  expectedVersion: number;
  action: 'submit' | 'approve' | 'reject' | 'apply';
  notes?: string | null;
}): Promise<{
  id: string;
  version: number;
  status: LexGovernanceStatus;
  resourceType: string | null;
  resourceId: string | null;
} | null> {
  return await withTenantContext(params.shopId, async (client) => {
    await client.query('BEGIN');
    try {
      const currentRes = await client.query<{
        id: string;
        entityType: LexGovernanceEntityType;
        targetId: string | null;
        version: number;
        status: LexGovernanceStatus;
        createdBy: string | null;
        proposedPayload: Record<string, unknown> | null;
      }>(
        `SELECT
           id,
           entity_type AS "entityType",
           target_id AS "targetId",
           version,
           status,
           created_by AS "createdBy",
           proposed_payload AS "proposedPayload"
         FROM lex_governance_requests
         WHERE id = $1
           AND shop_id = $2
         LIMIT 1
         FOR UPDATE`,
        [params.requestId, params.shopId]
      );

      const current = currentRes.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return null;
      }
      if (current.version !== params.expectedVersion) {
        await client.query('ROLLBACK');
        throw new Error('version_conflict');
      }

      const payload = current.proposedPayload ?? {};
      const fromStatus = current.status;
      let toStatus: LexGovernanceStatus;
      if (params.action === 'submit') {
        toStatus = 'pending_approval';
      } else if (params.action === 'approve') {
        if (current.createdBy && params.actorId && current.createdBy === params.actorId) {
          await client.query('ROLLBACK');
          throw new Error('maker_checker_self_approval_blocked');
        }
        toStatus = 'approved';
      } else if (params.action === 'reject') {
        toStatus = 'rejected';
      } else {
        toStatus = 'applied';
      }

      let resourceType: string | null = null;
      let resourceId: string | null = null;
      if (params.action === 'apply') {
        if (current.status !== 'approved') {
          await client.query('ROLLBACK');
          throw new Error('governance_request_not_approved');
        }
        const applied = await applyCanonicalPayload({
          client,
          entityType: current.entityType,
          targetId: current.targetId,
          payload,
          actorId: params.actorId,
        });
        resourceType = applied.resourceType;
        resourceId = applied.resourceId;
      }

      const updateRes = await client.query<{
        id: string;
        version: number;
        status: LexGovernanceStatus;
      }>(
        `UPDATE lex_governance_requests
         SET status = $3,
             version = version + 1,
             notes = COALESCE($4, notes),
             submitted_by = CASE WHEN $5 THEN $6 ELSE submitted_by END,
             submitted_at = CASE WHEN $5 THEN now() ELSE submitted_at END,
             approved_by = CASE WHEN $7 THEN $6 ELSE approved_by END,
             approved_at = CASE WHEN $7 THEN now() ELSE approved_at END,
             rejected_by = CASE WHEN $8 THEN $6 ELSE rejected_by END,
             rejected_at = CASE WHEN $8 THEN now() ELSE rejected_at END,
             applied_by = CASE WHEN $9 THEN $6 ELSE applied_by END,
             applied_at = CASE WHEN $9 THEN now() ELSE applied_at END,
             rejection_reason = CASE WHEN $8 THEN $4 ELSE rejection_reason END,
             updated_at = now()
         WHERE id = $1
           AND shop_id = $2
         RETURNING id, version, status`,
        [
          params.requestId,
          params.shopId,
          toStatus,
          params.notes ?? null,
          params.action === 'submit',
          params.actorId,
          params.action === 'approve',
          params.action === 'reject',
          params.action === 'apply',
        ]
      );

      const row = updateRes.rows[0]!;
      await recordGovernanceEvent({
        client,
        requestId: row.id,
        shopId: params.shopId,
        actorId: params.actorId,
        action: params.action,
        fromStatus,
        toStatus,
        details: {
          notes: params.notes ?? null,
          resourceType,
          resourceId,
        },
      });
      await client.query('COMMIT');
      return { ...row, resourceType, resourceId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function submitLexGovernanceRequest(params: {
  shopId: string;
  requestId: string;
  actorId: string | null;
  expectedVersion: number;
  notes?: string | null;
}) {
  return await transitionRequest({ ...params, action: 'submit' });
}

export async function approveLexGovernanceRequest(params: {
  shopId: string;
  requestId: string;
  actorId: string | null;
  expectedVersion: number;
  notes?: string | null;
}) {
  return await transitionRequest({ ...params, action: 'approve' });
}

export async function rejectLexGovernanceRequest(params: {
  shopId: string;
  requestId: string;
  actorId: string | null;
  expectedVersion: number;
  notes?: string | null;
}) {
  return await transitionRequest({ ...params, action: 'reject' });
}

export async function applyLexGovernanceRequest(params: {
  shopId: string;
  requestId: string;
  actorId: string | null;
  expectedVersion: number;
  notes?: string | null;
}) {
  return await transitionRequest({ ...params, action: 'apply' });
}

export function buildGovernancePayloadFromGlossary(
  entry: Partial<LexGlossaryEntryDto>
): Record<string, unknown> {
  return {
    domainCode: entry.domainCode ?? null,
    sourceLang: trimString(entry.sourceLang, 'ro'),
    targetLang: trimString(entry.targetLang, 'en'),
    sourceText: trimString(entry.sourceText),
    targetText: trimString(entry.targetText),
    translationKind: trimString(entry.translationKind, 'canonical'),
    priority: Math.max(1, Math.min(1000, toNumber(entry.priority, 100))),
    isLocked: entry.isLocked === true,
    isActive: entry.isActive !== false,
  };
}

export function buildGovernancePayloadFromRule(
  rule: Partial<LexTranslationRuleDto>
): Record<string, unknown> {
  return {
    ruleName: trimString(rule.ruleName),
    sourceLang: trimString(rule.sourceLang, 'ro'),
    targetLang: trimString(rule.targetLang, 'en'),
    matchTerm: trimString(rule.matchTerm),
    domainCode: rule.domainCode ?? null,
    targetTranslation: trimString(rule.targetTranslation),
    priority: Math.max(1, Math.min(1000, toNumber(rule.priority, 100))),
    isActive: rule.isActive !== false,
  };
}

export function buildGovernancePayloadFromDomainProfile(
  profile: Partial<LexDomainProfileDto>
): Record<string, unknown> {
  return {
    domainCode: trimString(profile.domainCode),
    nameRo: trimString(profile.nameRo),
    nameEn: trimString(profile.nameEn, '') || null,
    description: trimString(profile.description, '') || null,
    isActive: profile.isActive !== false,
  };
}

export function buildGovernancePayloadFromStopword(
  stopword: Partial<LexStopwordDto>
): Record<string, unknown> {
  return {
    locale: trimString(stopword.locale, 'ro'),
    word: trimString(stopword.word),
    wordType: trimString(stopword.wordType, 'noise'),
    priority: Math.max(1, Math.min(1000, toNumber(stopword.priority, 100))),
    isActive: stopword.isActive !== false,
  };
}
