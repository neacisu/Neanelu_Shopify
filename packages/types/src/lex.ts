/**
 * Module N: Lexical Intelligence & Contextual Translation types
 */

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export const LEX_RUN_TYPES = [
  'full_rebuild',
  'delta_rebuild',
  'context_rebuild',
  'translate_only',
  'publish_only',
  'legacy_backfill',
] as const;

export const LEX_PHASE_NAMES = [
  'extract.fragments',
  'extract.entities',
  'mine.terms',
  'aggregate.stats',
  'build.contexts',
  'embed.contexts',
  'cluster.senses',
  'resolve.attributes',
  'translate.candidates',
  'compose.localizations',
  'review.enqueue',
  'publish',
] as const;

export const LEX_RUN_STATUSES = [
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;

export const LEX_ENTITY_TYPES = [
  'term',
  'cluster',
  'translation',
  'fragment',
  'product',
  'collection',
  'master_product',
  'attribute_resolution',
] as const;

export const LEX_PUBLICATION_TARGET_TYPES = [
  'prod_attr_synonyms',
  'prod_translations',
  'prod_semantics',
  'shopify_collections.title_en',
  'shopify_collections.description_en',
] as const;

export const LEX_DECISION_TYPES = [
  'approve',
  'reject',
  'merge_terms',
  'split_cluster',
  'lock_translation',
  'publish',
  'assign',
] as const;

export const LEX_REVIEW_STATUSES = [
  'pending',
  'in_review',
  'approved',
  'rejected',
  'superseded',
] as const;

export const LEX_REVIEW_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export const LEX_LOCALIZATION_PUBLICATION_STATUSES = [
  'draft',
  'approved',
  'publishing',
  'published',
  'publish_failed',
  'superseded',
] as const;

export const LEX_PUBLICATION_TARGET_STATUSES = [
  'pending',
  'publishing',
  'published',
  'failed',
  'skipped',
  'rolled_back',
  'cancelled',
] as const;

export const LEX_GOVERNANCE_ENTITY_TYPES = [
  'glossary_entry',
  'translation_rule',
  'domain_profile',
  'stopword',
  'locked_translation',
  'attribute_resolution',
] as const;

export const LEX_GOVERNANCE_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'applied',
  'cancelled',
] as const;

export type LexRunType = (typeof LEX_RUN_TYPES)[number];
export type LexRunStatus = (typeof LEX_RUN_STATUSES)[number];
export type LexPhaseName = (typeof LEX_PHASE_NAMES)[number];
export type LexEntityType = (typeof LEX_ENTITY_TYPES)[number];
export type LexPublicationTargetType = (typeof LEX_PUBLICATION_TARGET_TYPES)[number];
export type LexDecisionType = (typeof LEX_DECISION_TYPES)[number];
export type LexReviewStatus = (typeof LEX_REVIEW_STATUSES)[number];
export type LexReviewSeverity = (typeof LEX_REVIEW_SEVERITIES)[number];
export type LexLocalizationPublicationStatus =
  (typeof LEX_LOCALIZATION_PUBLICATION_STATUSES)[number];
export type LexPublicationTargetStatus = (typeof LEX_PUBLICATION_TARGET_STATUSES)[number];
export type LexGovernanceEntityType = (typeof LEX_GOVERNANCE_ENTITY_TYPES)[number];
export type LexGovernanceStatus = (typeof LEX_GOVERNANCE_STATUSES)[number];

export interface LexRunRequestedJobPayload {
  shopId: string;
  runId: string;
  runType: LexRunType;
  triggeredBy: 'manual' | 'scheduler' | 'system';
  requestedAt: number;
  sourceScope?: Record<string, unknown>;
}

export interface LexShardJobPayload {
  shopId: string;
  runId: string;
  shardId: string;
  queuePhase: LexPhaseName;
  requestedAt: number;
}

export interface LexResolveAttributesJobPayload {
  shopId: string;
  runId: string;
  candidateIds?: string[];
  requestedAt: number;
}

export interface LexComposeLocalizationJobPayload {
  shopId: string;
  runId: string;
  entityType: 'product' | 'collection' | 'master_product';
  entityIds?: string[];
  targetLang: string;
  requestedAt: number;
}

export interface LexPublishJobPayload {
  shopId: string;
  targetIds?: string[];
  publicationTargetType?: LexPublicationTargetType;
  requestedAt: number;
  retryOnly?: boolean;
}

export interface LexRunSummary {
  id: string;
  shopId: string;
  runType: LexRunType;
  status: LexRunStatus;
  currentPhase?: string | null;
  startedAt: string | null;
  completedAt: string | null;
  fragmentsCount: number;
  occurrencesCount: number;
  termsCount: number;
  contextsCount: number;
  senseClustersCount: number;
  translationsCount: number;
  aiBatchesCount: number;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
}

export interface LexClusterDetail {
  id: string;
  termId: string;
  clusterKey: string;
  clusterMethod: string;
  domainCode: string | null;
  taxonomyId: string | null;
  labelRo: string | null;
  labelEn: string | null;
  description: string | null;
  confidenceScore: number | null;
  needsReview: boolean;
  isApproved: boolean;
}

export interface LexTermDetail {
  id: string;
  shopId: string | null;
  canonicalText: string;
  normalizedKey: string;
  displayTextRo: string | null;
  ngramSize: number;
  termType: string;
  domainCode: string | null;
  isTechnical: boolean;
  isProtected: boolean;
  status: string;
  variants: {
    id: string;
    variantText: string;
    locale: string;
    variantType: string;
    isPreferred: boolean;
    isApproved: boolean;
  }[];
  clusters: LexClusterDetail[];
}

export interface LexLocalizationDetail {
  id: string;
  entityType: 'product' | 'collection' | 'master_product';
  entityId: string;
  sourceLang: string;
  targetLang: string;
  titleText: string | null;
  descriptionText: string | null;
  descriptionShort: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  keywords: string[];
  version: number;
  qualityScore: number | null;
  publicationStatus: LexLocalizationPublicationStatus | (string & {});
  approvedAt: string | null;
}

export interface LexReviewItemDetail {
  id: string;
  entityType: LexEntityType;
  entityId: string;
  reviewReason: string;
  severity: LexReviewSeverity | (string & {});
  priority: number;
  version: number;
  status: LexReviewStatus | (string & {});
  notes: string | null;
  evidence: Record<string, unknown>;
}

export interface LexGlossaryEntryDto {
  id: string;
  shopId: string | null;
  domainCode: string | null;
  sourceLang: string;
  targetLang: string;
  sourceText: string;
  targetText: string;
  translationKind: string;
  priority: number;
  version: number;
  isLocked: boolean;
  isActive: boolean;
}

export interface LexPublicationTargetDto {
  id: string;
  targetType: string;
  targetRecordId: string | null;
  targetPath: string | null;
  status: LexPublicationTargetStatus | (string & {});
  attemptCount: number;
  errorMessage: string | null;
  updatedAt: string | null;
}

export interface LexWorkerHealthDto {
  id: string;
  label: string;
  ok: boolean;
  queueName: string | null;
  queueUrl: string | null;
  dlqQueueName: string | null;
  dlqUrl: string | null;
  currentJob: {
    jobId: string;
    jobName: string;
    startedAtIso: string;
    progressPct: number | null;
  } | null;
}

export interface LexQueueHealthDto {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  dlqEntries: number;
  queueUrl: string;
  dlqQueueName: string;
  dlqUrl: string;
}

export interface LexHealthAlertDto {
  key: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  href: string | null;
  queueName: string | null;
  workerId: string | null;
}

export interface LexPublicationRollbackStatusDto {
  rollbackable: boolean;
  rollbackBlockedReason: string | null;
  snapshotCompleteness: 'complete' | 'repairable' | 'blocked';
  needsRepair: boolean;
}

export interface LexMetricsDto {
  runsTotal: number;
  termsTotal: number;
  clustersTotal: number;
  glossaryTotal: number;
  reviewPending: number;
  reviewBacklog: number;
  localizationsApproved: number;
  publicationsPending: number;
  runsActive: number;
  runsPaused: number;
  pausedBudgetBlocked: number;
  pausedProviderUnavailable: number;
  shardsFailed: number;
  publicationsFailed: number;
  publishConflicts: number;
  staleCheckpoints: number;
  retentionLag: number;
  aiBatchBacklog: number;
  dlqEntries: number;
  workersOnline: number;
  workersTotal: number;
  workers: LexWorkerHealthDto[];
  queues: LexQueueHealthDto[];
  alerts: LexHealthAlertDto[];
}

export interface LexTimelineEventDto {
  id: string;
  kind: 'decision' | 'publish_event' | 'governance_event' | 'run_phase';
  action: string;
  status: string | null;
  actorId: string | null;
  createdAt: string | null;
  details: Record<string, unknown>;
}

export interface LexReviewDecisionDto {
  id: string;
  decisionType: string;
  decisionNotes: string | null;
  decidedBy: string | null;
  createdAt: string | null;
  oldValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
}

export interface LexLocalizationEvidenceDto {
  id: string;
  fragmentId: string;
  sortOrder: number;
  evidenceLabel: string | null;
  metadata: Record<string, unknown>;
}

export interface LexPublicationEventDto {
  id: string;
  action: string;
  status: string;
  errorMessage: string | null;
  createdAt: string | null;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
}

export interface LexLocalizationDetailDto extends LexLocalizationDetail {
  evidence: LexLocalizationEvidenceDto[];
  publications: LexPublicationTargetDto[];
}

export interface LexReviewDetailDto extends LexReviewItemDetail {
  assignedTo: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  decisions: LexReviewDecisionDto[];
  timeline: LexTimelineEventDto[];
  relatedLocalizations: Pick<
    LexLocalizationDetail,
    'id' | 'entityType' | 'entityId' | 'targetLang' | 'publicationStatus' | 'qualityScore'
  >[];
  relatedPublications: LexPublicationTargetDto[];
}

export interface LexPublicationDetailDto extends LexPublicationTargetDto {
  localizationId: string | null;
  payload: Record<string, unknown>;
  previousSnapshot: Record<string, unknown>;
  publishedSnapshot: Record<string, unknown>;
  rollbackable: boolean;
  rollbackBlockedReason: string | null;
  snapshotCompleteness: 'complete' | 'repairable' | 'blocked';
  needsRepair: boolean;
  queueLinks: {
    queueName: string;
    queueUrl: string;
    dlqQueueName: string;
    dlqUrl: string;
  };
  events: LexPublicationEventDto[];
}

export interface LexTranslationRuleDto {
  id: string;
  shopId: string | null;
  ruleName: string;
  sourceLang: string;
  targetLang: string;
  matchTerm: string;
  domainCode: string | null;
  targetTranslation: string;
  priority: number;
  version: number;
  isActive: boolean;
}

export interface LexDomainProfileDto {
  id: string;
  shopId: string | null;
  domainCode: string;
  nameRo: string;
  nameEn: string | null;
  description: string | null;
  version: number;
  isActive: boolean;
}

export interface LexStopwordDto {
  id: string;
  shopId: string | null;
  locale: string;
  word: string;
  wordType: string;
  priority: number;
  version: number;
  isActive: boolean;
}

export interface LexGovernanceRequestDto {
  id: string;
  entityType: LexGovernanceEntityType | (string & {});
  requestScope: 'global' | (string & {});
  targetId: string | null;
  title: string | null;
  version: number;
  status: LexGovernanceStatus | (string & {});
  proposedPayload: Record<string, unknown>;
  proposedHash: string;
  notes: string | null;
  rejectionReason: string | null;
  createdAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  appliedAt: string | null;
}

export interface LexGovernanceRequestEventDto {
  id: string;
  action: string;
  actorId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  details: Record<string, unknown>;
  createdAt: string | null;
}

export interface LexGovernanceRequestDetailDto extends LexGovernanceRequestDto {
  events: LexGovernanceRequestEventDto[];
}

export interface LexCursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface LexShopSettingsDto {
  shopId: string;
  version: number;
  enabled: boolean;
  sourceLang: string;
  targetLangs: string[];
  extractScope: Record<string, unknown>;
  shardSize: number;
  thresholds: Record<string, unknown>;
  retentionDaysFragments: number;
  retentionDaysOccurrences: number;
  retentionDaysContexts: number;
  autoPublishProducts: boolean;
  autoPublishAttributes: boolean;
  autoPublishCollections: boolean;
}

export interface LexAccessPermissions {
  canView: boolean;
  canReview: boolean;
  canPublish: boolean;
  canManageSettings: boolean;
}

export interface LexBootstrapDto {
  moduleEnabled: boolean;
  reviewUiEnabled: boolean;
  collectionAdapterEnabled: boolean;
  shopEnabled: boolean;
  isAdmin: boolean;
  permissions: LexAccessPermissions;
  settingsSummary: Pick<
    LexShopSettingsDto,
    | 'shopId'
    | 'version'
    | 'enabled'
    | 'sourceLang'
    | 'targetLangs'
    | 'shardSize'
    | 'autoPublishProducts'
    | 'autoPublishAttributes'
    | 'autoPublishCollections'
  >;
}

export interface LexReviewDecisionRequest {
  decisionType: LexDecisionType;
  expectedVersion: number;
  notes?: string | null;
  newValue?: Record<string, unknown>;
}

export interface LexAssignReviewRequest {
  expectedVersion: number;
  assignedTo?: string | null;
  notes?: string | null;
}

export interface LexRollbackPublishRequest {
  notes?: string | null;
}

export interface LexGovernanceApprovalRequest {
  expectedVersion: number;
  notes?: string | null;
}

export interface LexGovernanceApplyRequest {
  expectedVersion: number;
  notes?: string | null;
}

export interface LexRetentionJobPayload {
  shopId: string;
  requestedAt: number;
  retentionDays?: number;
}

export function validateLexRunRequestedJobPayload(
  data: unknown
): data is LexRunRequestedJobPayload {
  if (!data || typeof data !== 'object') return false;
  const payload = data as Partial<LexRunRequestedJobPayload>;

  if (typeof payload.shopId !== 'string' || !isCanonicalUuid(payload.shopId)) return false;
  if (typeof payload.runId !== 'string' || !isCanonicalUuid(payload.runId)) return false;
  if (!payload.runType || !LEX_RUN_TYPES.includes(payload.runType)) return false;
  if (
    payload.triggeredBy !== 'manual' &&
    payload.triggeredBy !== 'scheduler' &&
    payload.triggeredBy !== 'system'
  ) {
    return false;
  }
  if (typeof payload.requestedAt !== 'number' || !Number.isFinite(payload.requestedAt))
    return false;
  return true;
}

export function validateLexShardJobPayload(data: unknown): data is LexShardJobPayload {
  if (!data || typeof data !== 'object') return false;
  const payload = data as Partial<LexShardJobPayload>;
  if (typeof payload.shopId !== 'string' || !isCanonicalUuid(payload.shopId)) return false;
  if (typeof payload.runId !== 'string' || !isCanonicalUuid(payload.runId)) return false;
  if (typeof payload.shardId !== 'string' || !isCanonicalUuid(payload.shardId)) return false;
  if (typeof payload.queuePhase !== 'string' || !payload.queuePhase.trim()) return false;
  if (typeof payload.requestedAt !== 'number' || !Number.isFinite(payload.requestedAt))
    return false;
  return true;
}

export function validateLexComposeLocalizationJobPayload(
  data: unknown
): data is LexComposeLocalizationJobPayload {
  if (!data || typeof data !== 'object') return false;
  const payload = data as Partial<LexComposeLocalizationJobPayload>;
  if (typeof payload.shopId !== 'string' || !isCanonicalUuid(payload.shopId)) return false;
  if (typeof payload.runId !== 'string' || !isCanonicalUuid(payload.runId)) return false;
  if (
    payload.entityType !== 'product' &&
    payload.entityType !== 'collection' &&
    payload.entityType !== 'master_product'
  ) {
    return false;
  }
  if (typeof payload.targetLang !== 'string' || !payload.targetLang.trim()) return false;
  if (typeof payload.requestedAt !== 'number' || !Number.isFinite(payload.requestedAt))
    return false;
  return true;
}

export function validateLexPublishJobPayload(data: unknown): data is LexPublishJobPayload {
  if (!data || typeof data !== 'object') return false;
  const payload = data as Partial<LexPublishJobPayload>;
  if (typeof payload.shopId !== 'string' || !isCanonicalUuid(payload.shopId)) return false;
  if (typeof payload.requestedAt !== 'number' || !Number.isFinite(payload.requestedAt))
    return false;
  if (
    payload.publicationTargetType !== undefined &&
    !LEX_PUBLICATION_TARGET_TYPES.includes(payload.publicationTargetType)
  ) {
    return false;
  }
  return true;
}

export function validateLexRetentionJobPayload(data: unknown): data is LexRetentionJobPayload {
  if (!data || typeof data !== 'object') return false;
  const payload = data as Partial<LexRetentionJobPayload>;
  if (typeof payload.shopId !== 'string' || !isCanonicalUuid(payload.shopId)) return false;
  if (typeof payload.requestedAt !== 'number' || !Number.isFinite(payload.requestedAt))
    return false;
  if (
    payload.retentionDays !== undefined &&
    (typeof payload.retentionDays !== 'number' || !Number.isFinite(payload.retentionDays))
  ) {
    return false;
  }
  return true;
}
