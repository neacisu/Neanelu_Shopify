import type { AppEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import { toPgVectorLiteral } from '../processors/bulk-operations/pim/vector.js';
import { consensusChatCompletion } from './consensus-engine.js';
import {
  buildMenuAssignmentQueryText,
  FIXED_ROOT_MENU_ITEM_GIDS,
  isFixedRootMenuItem,
  type MenuAssignmentAction,
  type MenuAssignmentSource,
  type MenuAssignmentStatus,
} from './menu-ai.js';
import {
  generateDualEmbeddings,
  mergeMultiModelCandidates,
  resolveDualEmbeddingsProviders,
} from './multi-model-embedding.js';

const PRIMARY_COLLECTIONS_MENU_HANDLE = 'categorii-produse';
const MENU_ASSIGNMENT_VECTOR_LIMIT = 15;
const MENU_ASSIGNMENT_KEYWORD_LIMIT = 10;

export interface MenuAssignmentRecord {
  id: string;
  menuItemId: string | null;
  menuItemTitle: string;
  menuItemPath: string;
  menuItemLevel: number | null;
  assignmentSource: string;
  isPrimary: boolean;
  confidence: number | null;
  reasoning: string | null;
  translatedQuery: string | null;
  proposedPath: string | null;
  status: string;
  createdAt: string;
  approvedAt: string | null;
}

export interface MenuAssignmentStatusResponse {
  activeAssignments: MenuAssignmentRecord[];
  proposedAssignments: MenuAssignmentRecord[];
  rejectedAssignments: MenuAssignmentRecord[];
  primaryAssignment: MenuAssignmentRecord | null;
  collectionMenuPath: string | null;
  canRunAi: boolean;
}

interface CollectionMenuAssignmentContext {
  id: string;
  title: string;
  description: string | null;
  titleEn: string | null;
  parentTitle: string | null;
  menuLevel: number | null;
  menuPath: string | null;
  taxonomyName: string | null;
  productSamples: string[];
  existingMenuAssignments: MenuAssignmentRecord[];
}

interface MenuAssignmentCandidate {
  menuItemId: string;
  menuId: string;
  shopifyGid: string;
  title: string;
  path: string;
  level: number;
  similarity: number;
  resourceId: string | null;
}

interface MenuAssignmentTranslationResult {
  normalizedTitleEn: string;
  domainSummary: string;
  disambiguationTerms: string[];
  mustAvoidTerms: string[];
  confidence: number;
  rawOutput: string;
  model: string;
  guardrailsInput: Record<string, unknown>;
  guardrailsOutput: Record<string, unknown>;
  consensusMethod?: 'unanimous' | 'majority' | 'arbitration' | 'single_fallback';
  consensusScore?: number;
}

interface MenuAssignmentSelection {
  candidateIndex: number;
  role: 'primary' | 'secondary';
  confidence: number;
  reasoning: string;
}

interface MissingPathProposal {
  suggestedPath: string;
  reasoning: string;
  confidence: number | null;
}

interface MenuAssignmentSelectionResult {
  assignments: MenuAssignmentSelection[];
  missingPathProposal: MissingPathProposal | null;
  rawOutput: string;
  model: string;
  guardrailsInput: Record<string, unknown>;
  guardrailsOutput: Record<string, unknown>;
  consensusMethod?: 'unanimous' | 'majority' | 'arbitration' | 'single_fallback';
  consensusScore?: number;
}

export interface ExecuteMenuAssignmentResult {
  status: 'assigned' | 'proposed' | 'review_required' | 'error';
  assignments: MenuAssignmentRecord[];
  reviewRequired: boolean;
  primaryCount: number;
  secondaryCount: number;
  proposedCount: number;
  missingPathProposal: MissingPathProposal | null;
  message: string;
  consensusMethod?: 'unanimous' | 'majority' | 'arbitration' | 'single_fallback' | undefined;
  consensusScore?: number | undefined;
}

export interface ExecuteMenuAssignmentParams {
  shopId: string;
  collectionId: string;
  env: AppEnv;
  logger: Logger;
  onProgress?: (step: string, message: string, status?: 'done' | 'error') => void;
}

function parseHierarchySegments(menuPath: string | null): string[] {
  if (!menuPath) return [];
  return menuPath
    .split('>')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function buildHierarchyPromptContext(context: {
  collectionTitle: string;
  menuPath: string | null;
  menuLevel: number | null;
  parentTitle: string | null;
}): string {
  const segments = parseHierarchySegments(context.menuPath);
  if (segments.length === 0 && context.parentTitle == null && context.menuLevel == null) return '';

  const parentSegments =
    segments.length > 1 ? segments.slice(0, -1) : context.parentTitle ? [context.parentTitle] : [];
  const lines = ['Shopify hierarchy context:'];

  if (context.menuPath) {
    lines.push(`- full_tree_path: ${context.menuPath}`);
  }
  if (parentSegments.length > 0) {
    lines.push(`- ancestor_categories: ${parentSegments.join(' > ')}`);
  }
  if (context.parentTitle) {
    lines.push(`- direct_parent_category: ${context.parentTitle}`);
  }
  if (context.menuLevel != null) {
    lines.push(`- tree_level: ${context.menuLevel}`);
  }
  lines.push(
    `- current_collection_title: ${context.collectionTitle}`,
    '- Use this hierarchy only as domain disambiguation context.'
  );

  return lines.join('\n');
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function tokenizeQuery(value: string): string[] {
  return uniqueStrings(
    value
      .toLowerCase()
      .split(/[\s,;:()/_\-—–]+/)
      .filter((token) => token.length >= 3)
  );
}

async function loadCollectionMenuAssignmentContext(params: {
  shopId: string;
  collectionId: string;
}): Promise<CollectionMenuAssignmentContext | null> {
  return await withTenantContext(params.shopId, async (client) => {
    const collectionRes = await client.query<{
      id: string;
      title: string;
      description: string | null;
      title_en: string | null;
      parent_title: string | null;
      menu_level: number | null;
      menu_path: string | null;
      taxonomy_name: string | null;
    }>(
      `SELECT sc.id,
              sc.title,
              sc.description,
              sc.title_en,
              parent_sc.title AS parent_title,
              sc.menu_level,
              sc.menu_path,
              (
                SELECT pt.name
                  FROM pim_taxonomy_collection_map ptcm
                  JOIN prod_taxonomy pt
                    ON pt.id = ptcm.taxonomy_id
                 WHERE ptcm.shop_id = sc.shop_id
                   AND ptcm.collection_id = sc.id
                 ORDER BY ptcm.is_primary DESC NULLS LAST, ptcm.created_at ASC
                 LIMIT 1
              ) AS taxonomy_name
         FROM shopify_collections sc
         LEFT JOIN shopify_collections parent_sc
           ON parent_sc.id = sc.parent_collection_id
        WHERE sc.shop_id = $1
          AND sc.id = $2
        LIMIT 1`,
      [params.shopId, params.collectionId]
    );
    const base = collectionRes.rows[0];
    if (!base) return null;

    const productRes = await client.query<{ title: string }>(
      `SELECT p.title
         FROM shopify_collection_products scp
         JOIN shopify_products p
           ON p.id = scp.product_id
          AND p.shop_id = scp.shop_id
        WHERE scp.shop_id = $1
          AND scp.collection_id = $2
        ORDER BY scp.position ASC NULLS LAST, p.title ASC
        LIMIT 5`,
      [params.shopId, params.collectionId]
    );

    const assignments = await queryMenuAssignments({
      shopId: params.shopId,
      collectionId: params.collectionId,
    });

    return {
      id: base.id,
      title: base.title,
      description: base.description,
      titleEn: base.title_en,
      parentTitle: base.parent_title,
      menuLevel: base.menu_level,
      menuPath: base.menu_path,
      taxonomyName: base.taxonomy_name,
      productSamples: productRes.rows.map((row) => row.title),
      existingMenuAssignments: assignments,
    };
  });
}

async function queryMenuAssignments(params: {
  shopId: string;
  collectionId: string;
}): Promise<MenuAssignmentRecord[]> {
  return await withTenantContext(params.shopId, async (client) => {
    const result = await client.query<{
      id: string;
      menu_item_id: string | null;
      menu_item_title: string | null;
      menu_item_path: string | null;
      menu_item_level: number | null;
      assignment_source: string;
      is_primary: boolean;
      confidence: number | null;
      reasoning: string | null;
      translated_query: string | null;
      proposed_path: string | null;
      status: string;
      created_at: string;
      approved_at: string | null;
    }>(
      `SELECT a.id,
              a.menu_item_id,
              mi.title AS menu_item_title,
              array_to_string(mi.path, ' > ') AS menu_item_path,
              mi.level AS menu_item_level,
              a.assignment_source,
              a.is_primary,
              a.confidence,
              a.reasoning,
              a.translated_query,
              a.proposed_path,
              a.status,
              a.created_at::text,
              a.approved_at::text
         FROM shopify_collection_menu_assignments a
         LEFT JOIN shopify_menu_items mi
           ON mi.id = a.menu_item_id
          AND mi.shop_id = a.shop_id
        WHERE a.shop_id = $1
          AND a.collection_id = $2
        ORDER BY a.is_primary DESC, a.created_at ASC`,
      [params.shopId, params.collectionId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      menuItemId: row.menu_item_id,
      menuItemTitle: row.menu_item_title ?? row.proposed_path ?? 'Propunere AI',
      menuItemPath: row.menu_item_path ?? row.proposed_path ?? '',
      menuItemLevel: row.menu_item_level,
      assignmentSource: row.assignment_source,
      isPrimary: row.is_primary,
      confidence: row.confidence,
      reasoning: row.reasoning,
      translatedQuery: row.translated_query,
      proposedPath: row.proposed_path,
      status: row.status,
      createdAt: row.created_at,
      approvedAt: row.approved_at,
    }));
  });
}

async function hasMenuEmbeddingColumn(shopId: string): Promise<boolean> {
  return await withTenantContext(shopId, async (client) => {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'shopify_menu_items'
            AND column_name = 'embedding'
       ) AS exists`
    );
    return result.rows[0]?.exists === true;
  });
}

async function hasMenuAssignmentTables(shopId: string): Promise<boolean> {
  return await withTenantContext(shopId, async (client) => {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('shopify_collection_menu_assignments', 'shopify_collection_menu_assignment_audits')`
    );
    return Number(result.rows[0]?.count ?? '0') === 2;
  });
}

async function countEligibleEmbeddedMenuCandidates(shopId: string): Promise<number> {
  return await withTenantContext(shopId, async (client) => {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM shopify_menu_items mi
         JOIN shopify_menus sm
           ON sm.id = mi.menu_id
          AND sm.shop_id = mi.shop_id
        WHERE mi.shop_id = $1
          AND sm.handle = $2
          AND mi.item_type = 'COLLECTION'
          AND mi.resource_id IS NOT NULL
          AND mi.embedding IS NOT NULL
          AND mi.level > 1`,
      [shopId, PRIMARY_COLLECTIONS_MENU_HANDLE]
    );
    return Number(result.rows[0]?.count ?? '0');
  });
}

export async function getMenuAssignmentStatus(params: {
  shopId: string;
  collectionId: string;
}): Promise<MenuAssignmentStatusResponse | null> {
  const [context, embeddingColumnExists, assignmentTablesExist] = await Promise.all([
    loadCollectionMenuAssignmentContext(params),
    hasMenuEmbeddingColumn(params.shopId),
    hasMenuAssignmentTables(params.shopId),
  ]);
  if (!context) return null;

  const assignments = assignmentTablesExist ? context.existingMenuAssignments : [];
  const eligibleCandidates =
    embeddingColumnExists && assignmentTablesExist
      ? await countEligibleEmbeddedMenuCandidates(params.shopId)
      : 0;
  const activeAssignments = assignments.filter(
    (assignment) => assignment.status === 'active' || assignment.status === 'approved'
  );
  const proposedAssignments = assignments.filter((assignment) => assignment.status === 'proposed');
  const rejectedAssignments = assignments.filter((assignment) => assignment.status === 'rejected');
  const primaryAssignment = activeAssignments.find((assignment) => assignment.isPrimary) ?? null;

  return {
    activeAssignments,
    proposedAssignments,
    rejectedAssignments,
    primaryAssignment,
    collectionMenuPath: context.menuPath,
    canRunAi: embeddingColumnExists && assignmentTablesExist && eligibleCandidates > 0,
  };
}

async function translateCollectionForMenuAssignment(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  context: CollectionMenuAssignmentContext;
  onProgress?: ExecuteMenuAssignmentParams['onProgress'];
}): Promise<MenuAssignmentTranslationResult> {
  const hierarchyContext = buildHierarchyPromptContext({
    collectionTitle: params.context.title,
    menuPath: params.context.menuPath,
    menuLevel: params.context.menuLevel,
    parentTitle: params.context.parentTitle,
  });

  const prompt = [
    `Collection title: ${params.context.title}`,
    params.context.titleEn ? `Existing English title: ${params.context.titleEn}` : null,
    params.context.description ? `Description: ${params.context.description}` : null,
    params.context.taxonomyName ? `Existing taxonomy: ${params.context.taxonomyName}` : null,
    hierarchyContext,
    params.context.productSamples.length > 0
      ? `Sample products:\n${params.context.productSamples.map((sample, index) => `${index + 1}. ${sample}`).join('\n')}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n');

  const consensus = await consensusChatCompletion<{
    normalizedTitleEn?: unknown;
    domainSummary?: unknown;
    disambiguationTerms?: unknown;
    mustAvoidTerms?: unknown;
    confidence?: unknown;
  }>({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
    taskType: 'translation',
    systemPrompt: `You translate Romanian Shopify collection names into precise English category intent for menu placement.

Return STRICT JSON with exactly these fields:
- normalizedTitleEn: concise English category title
- domainSummary: 2-4 English words for the business domain
- disambiguationTerms: array of English terms that help retrieval
- mustAvoidTerms: array of misleading domains to avoid
- confidence: float 0.0-1.0

RULES:
1. Translate the current collection title, not a random broader category.
2. Use product samples and Shopify tree context only to disambiguate ambiguous Romanian words.
3. Keep technical/scientific terms exact when they are standard in English.
4. DomainSummary must describe the commercial domain, not the full path.
5. DisambiguationTerms must be retrieval-friendly nouns or noun phrases, maximum 6 entries.`,
    userPrompt: prompt,
    responseFormat: { type: 'json_object' },
    keyField: 'normalizedTitleEn',
    maxTokens: 400,
    onProgress: (event) =>
      params.onProgress?.(`consensus_${event.step}`, event.message, event.status),
  });

  const parsed = consensus.result;
  const normalizedTitleEn =
    typeof parsed.normalizedTitleEn === 'string' ? parsed.normalizedTitleEn.trim() : '';
  const domainSummary = typeof parsed.domainSummary === 'string' ? parsed.domainSummary.trim() : '';
  if (!normalizedTitleEn || !domainSummary) {
    throw new Error('translation_invalid_json_payload');
  }

  return {
    normalizedTitleEn,
    domainSummary,
    disambiguationTerms: Array.isArray(parsed.disambiguationTerms)
      ? uniqueStrings(parsed.disambiguationTerms.map((value) => String(value)))
      : [],
    mustAvoidTerms: Array.isArray(parsed.mustAvoidTerms)
      ? uniqueStrings(parsed.mustAvoidTerms.map((value) => String(value)))
      : [],
    confidence:
      typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    rawOutput: JSON.stringify(parsed),
    model: consensus.models.join(', '),
    guardrailsInput: {
      isValid: true,
      reason: null,
      scanners: [],
    },
    guardrailsOutput: {
      isValid: true,
      reason: null,
      scanners: [],
    },
    consensusMethod: consensus.method,
    consensusScore: consensus.consensusScore,
  };
}

async function retrieveMenuAssignmentCandidates(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  queryText: string;
  disambiguationTerms: readonly string[];
}): Promise<{
  candidates: MenuAssignmentCandidate[];
  embeddingModel: string;
  embeddingDimensions: number;
}> {
  const providers = await resolveDualEmbeddingsProviders({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
  });
  if (!providers.primary.isAvailable()) {
    throw new Error('Embeddings provider indisponibil pentru menu assignment.');
  }

  const embeddings = await generateDualEmbeddings({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
    text: params.queryText,
    primary: providers.primary,
    secondary: providers.secondary,
  });

  const keywordTerms = uniqueStrings([
    ...params.disambiguationTerms,
    ...tokenizeQuery(params.queryText),
  ]).slice(0, 8);

  const [primaryVectorResults, secondaryVectorResults, keywordResults] = await Promise.all([
    withTenantContext(params.shopId, async (client) => {
      const result = await client.query<MenuAssignmentCandidate>(
        `SELECT mi.id AS "menuItemId",
                mi.menu_id AS "menuId",
                mi.shopify_gid AS "shopifyGid",
                mi.title,
                array_to_string(mi.path, ' > ') AS path,
                mi.level,
                (1 - (mi.embedding <=> $1::vector(2000)))::float AS similarity,
                mi.resource_id AS "resourceId"
           FROM shopify_menu_items mi
           JOIN shopify_menus sm
             ON sm.id = mi.menu_id
            AND sm.shop_id = mi.shop_id
          WHERE mi.shop_id = $2
            AND sm.handle = $3
            AND mi.item_type = 'COLLECTION'
            AND mi.resource_id IS NOT NULL
            AND mi.embedding IS NOT NULL
            AND mi.level > 1
          ORDER BY mi.embedding <=> $1::vector(2000)
          LIMIT $4`,
        [
          toPgVectorLiteral(embeddings.primaryEmbedding),
          params.shopId,
          PRIMARY_COLLECTIONS_MENU_HANDLE,
          MENU_ASSIGNMENT_VECTOR_LIMIT,
        ]
      );
      return result.rows;
    }),
    embeddings.secondaryEmbedding && embeddings.secondaryModel
      ? withTenantContext(params.shopId, async (client) => {
          const result = await client.query<MenuAssignmentCandidate>(
            `SELECT mi.id AS "menuItemId",
                    mi.menu_id AS "menuId",
                    mi.shopify_gid AS "shopifyGid",
                    mi.title,
                    array_to_string(mi.path, ' > ') AS path,
                    mi.level,
                    (1 - (mi.embedding_secondary <=> $1::vector(2000)))::float AS similarity,
                    mi.resource_id AS "resourceId"
               FROM shopify_menu_items mi
               JOIN shopify_menus sm
                 ON sm.id = mi.menu_id
                AND sm.shop_id = mi.shop_id
              WHERE mi.shop_id = $2
                AND sm.handle = $3
                AND mi.item_type = 'COLLECTION'
                AND mi.resource_id IS NOT NULL
                AND mi.embedding_secondary IS NOT NULL
                AND mi.embedding_model_secondary = $5
                AND mi.level > 1
              ORDER BY mi.embedding_secondary <=> $1::vector(2000)
              LIMIT $4`,
            [
              toPgVectorLiteral(embeddings.secondaryEmbedding!),
              params.shopId,
              PRIMARY_COLLECTIONS_MENU_HANDLE,
              MENU_ASSIGNMENT_VECTOR_LIMIT,
              embeddings.secondaryModel,
            ]
          );
          return result.rows;
        })
      : Promise.resolve([]),
    keywordTerms.length > 0
      ? withTenantContext(params.shopId, async (client) => {
          const conditions = keywordTerms
            .map((_, index) => `LOWER(mi.embedding_text) LIKE $${index + 4}`)
            .join(' OR ');
          const result = await client.query<MenuAssignmentCandidate>(
            `SELECT mi.id AS "menuItemId",
                    mi.menu_id AS "menuId",
                    mi.shopify_gid AS "shopifyGid",
                    mi.title,
                    array_to_string(mi.path, ' > ') AS path,
                    mi.level,
                    0.72::float AS similarity,
                    mi.resource_id AS "resourceId"
               FROM shopify_menu_items mi
               JOIN shopify_menus sm
                 ON sm.id = mi.menu_id
                AND sm.shop_id = mi.shop_id
              WHERE mi.shop_id = $1
                AND sm.handle = $2
                AND mi.item_type = 'COLLECTION'
                AND mi.resource_id IS NOT NULL
                AND mi.embedding IS NOT NULL
                AND mi.level > 1
                AND (${conditions})
              ORDER BY mi.level ASC, mi.title ASC
              LIMIT $3`,
            [
              params.shopId,
              PRIMARY_COLLECTIONS_MENU_HANDLE,
              MENU_ASSIGNMENT_KEYWORD_LIMIT,
              ...keywordTerms.map((term) => `%${term.toLowerCase()}%`),
            ]
          );
          return result.rows;
        })
      : Promise.resolve([]),
  ]);

  const vectorResults = mergeMultiModelCandidates(
    primaryVectorResults.map((candidate) => ({ ...candidate, id: candidate.menuItemId })),
    secondaryVectorResults.map((candidate) => ({ ...candidate, id: candidate.menuItemId })),
    'shopify_menu_items'
  ).map(({ id: _id, ...candidate }) => candidate);

  const merged = new Map<string, MenuAssignmentCandidate>();
  for (const candidate of [...vectorResults, ...keywordResults]) {
    if (!merged.has(candidate.menuItemId)) {
      merged.set(candidate.menuItemId, candidate);
      continue;
    }
    const existing = merged.get(candidate.menuItemId)!;
    if (candidate.similarity > existing.similarity) {
      merged.set(candidate.menuItemId, candidate);
    }
  }

  return {
    candidates: [...merged.values()].sort((left, right) => right.similarity - left.similarity),
    embeddingModel: embeddings.secondaryModel
      ? `${embeddings.primaryModel} + ${embeddings.secondaryModel}`
      : embeddings.primaryModel,
    embeddingDimensions: providers.primary.model.dimensions,
  };
}

async function reasonAboutMenuAssignments(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  context: CollectionMenuAssignmentContext;
  translation: MenuAssignmentTranslationResult;
  candidates: readonly MenuAssignmentCandidate[];
  onProgress?: ExecuteMenuAssignmentParams['onProgress'];
}): Promise<MenuAssignmentSelectionResult> {
  const hierarchyContext = buildHierarchyPromptContext({
    collectionTitle: params.context.title,
    menuPath: params.context.menuPath,
    menuLevel: params.context.menuLevel,
    parentTitle: params.context.parentTitle,
  });
  const candidateText = params.candidates
    .map(
      (candidate, index) =>
        `${index + 1}. ${candidate.path} | level=${candidate.level} | similarity=${candidate.similarity.toFixed(3)}`
    )
    .join('\n');

  const prompt = [
    `Romanian title: ${params.context.title}`,
    `Normalized English title: ${params.translation.normalizedTitleEn}`,
    `Domain summary: ${params.translation.domainSummary}`,
    params.translation.disambiguationTerms.length > 0
      ? `Disambiguation terms: ${params.translation.disambiguationTerms.join(', ')}`
      : null,
    params.translation.mustAvoidTerms.length > 0
      ? `Avoid domains: ${params.translation.mustAvoidTerms.join(', ')}`
      : null,
    params.context.taxonomyName ? `Existing taxonomy: ${params.context.taxonomyName}` : null,
    params.context.productSamples.length > 0
      ? `Sample products:\n${params.context.productSamples.map((sample, index) => `${index + 1}. ${sample}`).join('\n')}`
      : null,
    hierarchyContext,
    `Candidates:\n${candidateText}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n');

  const consensus = await consensusChatCompletion<{
    assignments?: unknown;
    missingPathProposal?: unknown;
  }>({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
    taskType: 'classification',
    systemPrompt: `You place Shopify collections into an existing menu tree.

Return STRICT JSON:
{
  "assignments": [
    {
      "candidateIndex": 1,
      "role": "primary",
      "confidence": 0.92,
      "reasoning": "..."
    }
  ],
  "missingPathProposal": {
    "suggestedPath": "Root > Child > New Node",
    "reasoning": "...",
    "confidence": 0.55
  }
}

RULES:
1. Candidate indexes are 1-based and must reference the provided candidate list only.
2. You may return multiple assignments when the collection legitimately belongs in multiple branches.
3. Choose exactly one primary when at least one assignment is valid.
4. NEVER assign to a root category.
5. NEVER modify or replace any fixed root category.
6. If no candidate is safe enough, return assignments: [] and use missingPathProposal instead.
7. If confidence is below 0.40, do not force an assignment.`,
    userPrompt: prompt,
    responseFormat: { type: 'json_object' },
    keyField: 'assignments[0].candidateIndex',
    maxTokens: 900,
    onProgress: (event) =>
      params.onProgress?.(`consensus_${event.step}`, event.message, event.status),
  });

  const parsed = consensus.result;
  const assignments = Array.isArray(parsed.assignments)
    ? parsed.assignments.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const record = item as Record<string, unknown>;
        const candidateIndex =
          typeof record['candidateIndex'] === 'number' ? Math.trunc(record['candidateIndex']) : NaN;
        const role: 'primary' | 'secondary' =
          record['role'] === 'secondary' ? 'secondary' : 'primary';
        const confidence =
          typeof record['confidence'] === 'number'
            ? Math.max(0, Math.min(1, record['confidence']))
            : null;
        const reasoning = typeof record['reasoning'] === 'string' ? record['reasoning'].trim() : '';
        if (!Number.isFinite(candidateIndex) || confidence == null || !reasoning) {
          return [];
        }
        if (candidateIndex < 1 || candidateIndex > params.candidates.length) {
          return [];
        }
        const candidate = params.candidates[candidateIndex - 1];
        if (
          !candidate ||
          isFixedRootMenuItem({ shopifyGid: candidate.shopifyGid, level: candidate.level })
        ) {
          return [];
        }
        return [{ candidateIndex, role, confidence, reasoning }];
      })
    : [];

  const missingPathProposal =
    parsed.missingPathProposal &&
    typeof parsed.missingPathProposal === 'object' &&
    !Array.isArray(parsed.missingPathProposal)
      ? (() => {
          const value = parsed.missingPathProposal as Record<string, unknown>;
          const suggestedPath =
            typeof value['suggestedPath'] === 'string' ? value['suggestedPath'].trim() : '';
          const reasoning = typeof value['reasoning'] === 'string' ? value['reasoning'].trim() : '';
          const confidence =
            typeof value['confidence'] === 'number'
              ? Math.max(0, Math.min(1, value['confidence']))
              : null;
          if (!suggestedPath || !reasoning) return null;
          const firstSegment = parseHierarchySegments(suggestedPath)[0] ?? null;
          const allowedRoots = [
            'Bricolaj & Materiale',
            'Casa & Gradina',
            'Fitofarmacie',
            'Sisteme de Irigatii',
            'Pompe & Motopompe',
            'Utilaje AGRO & Piese',
            'Piese de Schimb Vehicule',
          ];
          if (!firstSegment || !allowedRoots.includes(firstSegment)) {
            return null;
          }
          return { suggestedPath, reasoning, confidence };
        })()
      : null;

  return {
    assignments,
    missingPathProposal,
    rawOutput: JSON.stringify(parsed),
    model: consensus.models.join(', '),
    guardrailsInput: {
      isValid: true,
      reason: null,
      scanners: [],
    },
    guardrailsOutput: {
      isValid: true,
      reason: null,
      scanners: [],
    },
    consensusMethod: consensus.method,
    consensusScore: consensus.consensusScore,
  };
}

async function persistMenuAssignmentResults(params: {
  shopId: string;
  context: CollectionMenuAssignmentContext;
  translation: MenuAssignmentTranslationResult;
  retrieval: { candidates: readonly MenuAssignmentCandidate[]; embeddingModel: string };
  selection: MenuAssignmentSelectionResult;
}): Promise<MenuAssignmentRecord[]> {
  const selectedAssignments = params.selection.assignments.filter(
    (assignment) => assignment.confidence >= 0.4
  );
  const primarySelectionIndex =
    selectedAssignments.findIndex((assignment) => assignment.role === 'primary') >= 0
      ? selectedAssignments.findIndex((assignment) => assignment.role === 'primary')
      : selectedAssignments.length > 0
        ? 0
        : -1;

  await withTenantContext(params.shopId, async (client) => {
    await client.query('BEGIN');
    try {
      if (params.translation.normalizedTitleEn.length > 0) {
        await client.query(
          `UPDATE shopify_collections
              SET title_en = $1,
                  updated_at = now()
            WHERE id = $2
              AND shop_id = $3`,
          [params.translation.normalizedTitleEn, params.context.id, params.shopId]
        );
      }

      if (primarySelectionIndex >= 0) {
        await client.query(
          `UPDATE shopify_collection_menu_assignments
              SET is_primary = false,
                  updated_at = now()
            WHERE shop_id = $1
              AND collection_id = $2`,
          [params.shopId, params.context.id]
        );
      }

      for (let index = 0; index < selectedAssignments.length; index += 1) {
        const assignment = selectedAssignments[index]!;
        const candidate = params.retrieval.candidates[assignment.candidateIndex - 1];
        if (!candidate) continue;
        const nextStatus: MenuAssignmentStatus =
          assignment.confidence >= 0.85 ? 'active' : 'proposed';
        const action: MenuAssignmentAction =
          assignment.confidence >= 0.85 ? 'auto_activated' : 'created';
        const isPrimary = index === primarySelectionIndex;
        const queryText = buildMenuAssignmentQueryText({
          normalizedTitleEn: params.translation.normalizedTitleEn,
          originalTitle: params.context.title,
          domainSummary: params.translation.domainSummary,
          disambiguationTerms: params.translation.disambiguationTerms,
        });

        const upsert = await client.query<{ id: string }>(
          `INSERT INTO shopify_collection_menu_assignments (
             shop_id,
             collection_id,
             menu_item_id,
             menu_id,
             assignment_source,
             is_primary,
             confidence,
             reasoning,
             translated_query,
             model_translation,
             model_embedding,
             model_selection,
             proposed_path,
             status,
             approved_at,
             approved_by,
             created_at,
             updated_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, $13, NULL, NULL, now(), now()
           )
           ON CONFLICT (shop_id, collection_id, menu_item_id) WHERE menu_item_id IS NOT NULL
           DO UPDATE SET
             menu_id = EXCLUDED.menu_id,
             assignment_source = EXCLUDED.assignment_source,
             is_primary = EXCLUDED.is_primary,
             confidence = EXCLUDED.confidence,
             reasoning = EXCLUDED.reasoning,
             translated_query = EXCLUDED.translated_query,
             model_translation = EXCLUDED.model_translation,
             model_embedding = EXCLUDED.model_embedding,
             model_selection = EXCLUDED.model_selection,
             proposed_path = NULL,
             status = EXCLUDED.status,
             approved_at = NULL,
             approved_by = NULL,
             updated_at = now()
           RETURNING id`,
          [
            params.shopId,
            params.context.id,
            candidate.menuItemId,
            candidate.menuId,
            'ai' satisfies MenuAssignmentSource,
            isPrimary,
            assignment.confidence,
            assignment.reasoning,
            queryText,
            params.translation.model,
            params.retrieval.embeddingModel,
            params.selection.model,
            nextStatus,
          ]
        );
        const assignmentId = upsert.rows[0]?.id;
        if (!assignmentId) continue;

        await client.query(
          `INSERT INTO shopify_collection_menu_assignment_audits (
             shop_id,
             assignment_id,
             collection_id,
             action,
             input_context,
             candidate_set,
             llm_output_raw,
             guardrails_verdict,
             models_used,
             confidence_scores,
             created_at
           )
           VALUES (
             $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10::jsonb, now()
           )`,
          [
            params.shopId,
            assignmentId,
            params.context.id,
            action,
            JSON.stringify({
              collectionTitle: params.context.title,
              taxonomyName: params.context.taxonomyName,
              productSamples: params.context.productSamples,
              menuPath: params.context.menuPath,
            }),
            JSON.stringify(
              params.retrieval.candidates.map((candidateItem) => ({
                menuItemId: candidateItem.menuItemId,
                path: candidateItem.path,
                level: candidateItem.level,
                similarity: candidateItem.similarity,
              }))
            ),
            params.selection.rawOutput,
            JSON.stringify({
              translationInput: params.translation.guardrailsInput,
              translationOutput: params.translation.guardrailsOutput,
              selectionInput: params.selection.guardrailsInput,
              selectionOutput: params.selection.guardrailsOutput,
            }),
            JSON.stringify({
              translation: params.translation.model,
              embedding: params.retrieval.embeddingModel,
              selection: params.selection.model,
            }),
            JSON.stringify({
              assignmentConfidence: assignment.confidence,
              translationConfidence: params.translation.confidence,
            }),
          ]
        );
      }

      if (params.selection.missingPathProposal) {
        const proposal = params.selection.missingPathProposal;
        const queryText = buildMenuAssignmentQueryText({
          normalizedTitleEn: params.translation.normalizedTitleEn,
          originalTitle: params.context.title,
          domainSummary: params.translation.domainSummary,
          disambiguationTerms: params.translation.disambiguationTerms,
        });
        const upsert = await client.query<{ id: string }>(
          `INSERT INTO shopify_collection_menu_assignments (
             shop_id,
             collection_id,
             menu_item_id,
             menu_id,
             assignment_source,
             is_primary,
             confidence,
             reasoning,
             translated_query,
             model_translation,
             model_embedding,
             model_selection,
             proposed_path,
             status,
             approved_at,
             approved_by,
             created_at,
             updated_at
           )
           VALUES (
             $1, $2, NULL, NULL, $3, false, $4, $5, $6, $7, $8, $9, $10, 'proposed', NULL, NULL, now(), now()
           )
           ON CONFLICT (shop_id, collection_id, proposed_path) WHERE proposed_path IS NOT NULL
           DO UPDATE SET
             confidence = EXCLUDED.confidence,
             reasoning = EXCLUDED.reasoning,
             translated_query = EXCLUDED.translated_query,
             model_translation = EXCLUDED.model_translation,
             model_embedding = EXCLUDED.model_embedding,
             model_selection = EXCLUDED.model_selection,
             status = 'proposed',
             updated_at = now()
           RETURNING id`,
          [
            params.shopId,
            params.context.id,
            'ai' satisfies MenuAssignmentSource,
            proposal.confidence,
            proposal.reasoning,
            queryText,
            params.translation.model,
            params.retrieval.embeddingModel,
            params.selection.model,
            proposal.suggestedPath,
          ]
        );
        const assignmentId = upsert.rows[0]?.id;
        if (assignmentId) {
          await client.query(
            `INSERT INTO shopify_collection_menu_assignment_audits (
               shop_id,
               assignment_id,
               collection_id,
               action,
               input_context,
               candidate_set,
               llm_output_raw,
               guardrails_verdict,
               models_used,
               confidence_scores,
               created_at
             )
             VALUES (
               $1, $2, $3, 'created', $4::jsonb, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb, now()
             )`,
            [
              params.shopId,
              assignmentId,
              params.context.id,
              JSON.stringify({
                collectionTitle: params.context.title,
                menuPath: params.context.menuPath,
                productSamples: params.context.productSamples,
              }),
              JSON.stringify(
                params.retrieval.candidates.map((candidateItem) => ({
                  menuItemId: candidateItem.menuItemId,
                  path: candidateItem.path,
                  level: candidateItem.level,
                  similarity: candidateItem.similarity,
                }))
              ),
              params.selection.rawOutput,
              JSON.stringify({
                translationInput: params.translation.guardrailsInput,
                translationOutput: params.translation.guardrailsOutput,
                selectionInput: params.selection.guardrailsInput,
                selectionOutput: params.selection.guardrailsOutput,
              }),
              JSON.stringify({
                translation: params.translation.model,
                embedding: params.retrieval.embeddingModel,
                selection: params.selection.model,
              }),
              JSON.stringify({
                missingPathConfidence: proposal.confidence,
              }),
            ]
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return await queryMenuAssignments({
    shopId: params.shopId,
    collectionId: params.context.id,
  });
}

export async function executeMenuAssignmentForCollection(
  params: ExecuteMenuAssignmentParams
): Promise<ExecuteMenuAssignmentResult> {
  const [assignmentTablesExist, embeddingColumnExists] = await Promise.all([
    hasMenuAssignmentTables(params.shopId),
    hasMenuEmbeddingColumn(params.shopId),
  ]);
  if (!assignmentTablesExist) {
    throw new Error('Tabelele de menu assignment nu există încă. Rulează migrațiile mai întâi.');
  }
  if (!embeddingColumnExists) {
    throw new Error(
      'Coloana embedding nu există pe shopify_menu_items. Rulează migrațiile mai întâi.'
    );
  }

  params.onProgress?.('loading_context', 'Încarc contextul colecției...');
  const context = await loadCollectionMenuAssignmentContext({
    shopId: params.shopId,
    collectionId: params.collectionId,
  });
  if (!context) {
    throw new Error('Colecția nu a fost găsită.');
  }
  params.onProgress?.('loading_context', 'Contextul colecției a fost încărcat.', 'done');

  params.onProgress?.('translating', `Traduc semantic „${context.title}"...`);
  const translation = await translateCollectionForMenuAssignment({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
    context,
    onProgress: params.onProgress,
  });
  params.onProgress?.(
    'translating',
    `Traducere: ${translation.normalizedTitleEn} (${Math.round(translation.confidence * 100)}%)`,
    'done'
  );

  const queryText = buildMenuAssignmentQueryText({
    normalizedTitleEn: translation.normalizedTitleEn,
    originalTitle: context.title,
    domainSummary: translation.domainSummary,
    disambiguationTerms: translation.disambiguationTerms,
  });

  params.onProgress?.('embedding_query', 'Generez embedding pentru interogarea compozită...');
  const retrieval = await retrieveMenuAssignmentCandidates({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
    queryText,
    disambiguationTerms: translation.disambiguationTerms,
  });
  params.onProgress?.(
    'embedding_query',
    `Embedding generat cu ${retrieval.embeddingModel}.`,
    'done'
  );

  params.onProgress?.('retrieving_candidates', 'Caut candidați în arborele de meniu...');
  if (retrieval.candidates.length === 0) {
    params.onProgress?.(
      'retrieving_candidates',
      'Nu există candidați eligibili cu embedding.',
      'error'
    );
    return {
      status: 'error',
      assignments: [],
      reviewRequired: false,
      primaryCount: 0,
      secondaryCount: 0,
      proposedCount: 0,
      missingPathProposal: null,
      message: 'Nu există candidați eligibili cu embedding în meniul sincronizat.',
      consensusMethod: translation.consensusMethod,
      consensusScore: translation.consensusScore,
    };
  }
  params.onProgress?.(
    'retrieving_candidates',
    `Au fost găsiți ${retrieval.candidates.length} candidați eligibili.`,
    'done'
  );

  params.onProgress?.('reasoning', 'Modelez selecția finală și verific regulile de protecție...');
  const selection = await reasonAboutMenuAssignments({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
    context,
    translation,
    candidates: retrieval.candidates,
    onProgress: params.onProgress,
  });
  params.onProgress?.('reasoning', 'Reasoning AI finalizat.', 'done');

  params.onProgress?.('persisting', 'Persist rezultatele și scriu audit trail...');
  const persistedAssignments = await persistMenuAssignmentResults({
    shopId: params.shopId,
    context,
    translation,
    retrieval,
    selection,
  });
  params.onProgress?.('persisting', 'Persistarea și audit trail-ul au fost finalizate.', 'done');

  const activeAssignments = persistedAssignments.filter(
    (assignment) => assignment.status === 'active' || assignment.status === 'approved'
  );
  const proposedAssignments = persistedAssignments.filter(
    (assignment) => assignment.status === 'proposed'
  );
  const primaryCount = activeAssignments.filter((assignment) => assignment.isPrimary).length;
  const secondaryCount = Math.max(0, activeAssignments.length - primaryCount);
  const reviewRequired =
    proposedAssignments.length > 0 ||
    selection.missingPathProposal != null ||
    selection.assignments.some((assignment) => assignment.confidence < 0.85);

  return {
    status:
      activeAssignments.length > 0 && !reviewRequired
        ? 'assigned'
        : activeAssignments.length > 0 || proposedAssignments.length > 0
          ? 'proposed'
          : 'review_required',
    assignments: persistedAssignments,
    reviewRequired,
    primaryCount,
    secondaryCount,
    proposedCount: proposedAssignments.length,
    missingPathProposal: selection.missingPathProposal,
    message:
      activeAssignments.length > 0
        ? `${primaryCount} primară, ${secondaryCount} secundare`
        : selection.missingPathProposal
          ? `Propunere nouă: ${selection.missingPathProposal.suggestedPath}`
          : 'Review necesar',
    consensusMethod: selection.consensusMethod ?? translation.consensusMethod,
    consensusScore: selection.consensusScore ?? translation.consensusScore,
  };
}

async function loadAssignmentTarget(params: {
  shopId: string;
  collectionId: string;
  assignmentId: string;
}): Promise<{
  id: string;
  menuItemId: string | null;
  shopifyGid: string | null;
  level: number | null;
} | null> {
  return await withTenantContext(params.shopId, async (client) => {
    const result = await client.query<{
      id: string;
      menu_item_id: string | null;
      shopify_gid: string | null;
      level: number | null;
    }>(
      `SELECT a.id,
              a.menu_item_id,
              mi.shopify_gid,
              mi.level
         FROM shopify_collection_menu_assignments a
         LEFT JOIN shopify_menu_items mi
           ON mi.id = a.menu_item_id
          AND mi.shop_id = a.shop_id
        WHERE a.shop_id = $1
          AND a.collection_id = $2
          AND a.id = $3
        LIMIT 1`,
      [params.shopId, params.collectionId, params.assignmentId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      menuItemId: row.menu_item_id,
      shopifyGid: row.shopify_gid,
      level: row.level,
    };
  });
}

async function insertAssignmentAudit(params: {
  shopId: string;
  assignmentId: string | null;
  collectionId: string;
  action: MenuAssignmentAction;
  inputContext: Record<string, unknown>;
  confidenceScores?: Record<string, unknown>;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `INSERT INTO shopify_collection_menu_assignment_audits (
         shop_id,
         assignment_id,
         collection_id,
         action,
         input_context,
         candidate_set,
         llm_output_raw,
         guardrails_verdict,
         models_used,
         confidence_scores,
         created_at
       )
       VALUES (
         $1, $2, $3, $4, $5::jsonb, '[]'::jsonb, NULL, '{}'::jsonb, '{}'::jsonb, $6::jsonb, now()
       )`,
      [
        params.shopId,
        params.assignmentId,
        params.collectionId,
        params.action,
        JSON.stringify(params.inputContext),
        JSON.stringify(params.confidenceScores ?? {}),
      ]
    );
  });
}

export async function approveMenuAssignment(params: {
  shopId: string;
  collectionId: string;
  assignmentId: string;
  actor: string;
}): Promise<boolean> {
  const target = await loadAssignmentTarget(params);
  if (!target) return false;
  if (
    target.menuItemId &&
    isFixedRootMenuItem({ shopifyGid: target.shopifyGid, level: target.level })
  ) {
    throw new Error('Asignarea către un root fix nu poate fi aprobată.');
  }

  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE shopify_collection_menu_assignments
          SET status = 'approved',
              assignment_source = CASE WHEN assignment_source = 'ai' THEN 'reviewed_ai' ELSE assignment_source END,
              approved_at = now(),
              approved_by = $4,
              updated_at = now()
        WHERE shop_id = $1
          AND collection_id = $2
          AND id = $3`,
      [params.shopId, params.collectionId, params.assignmentId, params.actor]
    );
  });
  await insertAssignmentAudit({
    shopId: params.shopId,
    assignmentId: params.assignmentId,
    collectionId: params.collectionId,
    action: 'approved',
    inputContext: { actor: params.actor },
  });
  return true;
}

export async function rejectMenuAssignment(params: {
  shopId: string;
  collectionId: string;
  assignmentId: string;
  actor: string;
}): Promise<boolean> {
  const target = await loadAssignmentTarget(params);
  if (!target) return false;
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE shopify_collection_menu_assignments
          SET status = 'rejected',
              is_primary = false,
              approved_at = NULL,
              approved_by = NULL,
              updated_at = now()
        WHERE shop_id = $1
          AND collection_id = $2
          AND id = $3`,
      [params.shopId, params.collectionId, params.assignmentId]
    );
  });
  await insertAssignmentAudit({
    shopId: params.shopId,
    assignmentId: params.assignmentId,
    collectionId: params.collectionId,
    action: 'rejected',
    inputContext: { actor: params.actor },
  });
  return true;
}

export async function setPrimaryMenuAssignment(params: {
  shopId: string;
  collectionId: string;
  assignmentId: string;
  actor: string;
}): Promise<boolean> {
  const target = await loadAssignmentTarget(params);
  if (!target) return false;
  if (
    target.menuItemId &&
    isFixedRootMenuItem({ shopifyGid: target.shopifyGid, level: target.level })
  ) {
    throw new Error('Un root fix nu poate deveni asignare AI primară.');
  }

  await withTenantContext(params.shopId, async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE shopify_collection_menu_assignments
            SET is_primary = false,
                updated_at = now()
          WHERE shop_id = $1
            AND collection_id = $2`,
        [params.shopId, params.collectionId]
      );
      await client.query(
        `UPDATE shopify_collection_menu_assignments
            SET is_primary = true,
                updated_at = now()
          WHERE shop_id = $1
            AND collection_id = $2
            AND id = $3`,
        [params.shopId, params.collectionId, params.assignmentId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  await insertAssignmentAudit({
    shopId: params.shopId,
    assignmentId: params.assignmentId,
    collectionId: params.collectionId,
    action: 'set_primary',
    inputContext: { actor: params.actor },
  });
  return true;
}

export async function deleteMenuAssignment(params: {
  shopId: string;
  collectionId: string;
  assignmentId: string;
  actor: string;
}): Promise<boolean> {
  const target = await loadAssignmentTarget(params);
  if (!target) return false;
  await insertAssignmentAudit({
    shopId: params.shopId,
    assignmentId: params.assignmentId,
    collectionId: params.collectionId,
    action: 'deleted',
    inputContext: { actor: params.actor, deletedAssignmentId: params.assignmentId },
  });
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `DELETE FROM shopify_collection_menu_assignments
        WHERE shop_id = $1
          AND collection_id = $2
          AND id = $3`,
      [params.shopId, params.collectionId, params.assignmentId]
    );
  });
  return true;
}

export { FIXED_ROOT_MENU_ITEM_GIDS };
