import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApiClient } from './use-api';

export interface SimilarityMatchItem {
  id: string;
  product_id: string;
  product_title: string;
  product_image: string | null;
  source_url: string;
  source_title: string | null;
  source_brand: string | null;
  source_gtin: string | null;
  source_price: string | null;
  source_currency: string | null;
  similarity_score: string;
  match_method: string;
  match_confidence: string;
  is_primary_source: boolean | null;
  match_details: Record<string, unknown> | null;
  source_data: Record<string, unknown> | null;
  created_at: string;
}

export type TriageDecision = 'auto_approve' | 'ai_audit' | 'hitl_required' | 'rejected';

export interface SimilarityScoreBreakdown {
  gtinMatch?: number;
  titleSimilarity?: number;
  brandMatch?: number;
  priceProximity?: number;
}

export interface AIAuditResult {
  decision: string;
  confidence: number;
  reasoning: string;
  criticalDiscrepancies?: string[];
  usableForEnrichment?: boolean | string;
  isSameProduct?: string;
  auditedAt?: string;
  modelUsed?: string;
}

export interface MatchFilters {
  status?: string[];
  triageDecision?: TriageDecision[];
  matchMethod?: string[];
  similarityMin?: number;
  similarityMax?: number;
  requiresHumanReview?: boolean | null;
  hasAIAudit?: boolean | null;
  productId?: string;
  search?: string;
  sourceType?: ('organic' | 'shopping' | 'knowledge_graph')[];
  createdFrom?: string;
  createdTo?: string;
}

export interface MatchStats {
  total: number;
  pending: number;
  confirmed: number;
  rejected: number;
  autoApproved: number;
  aiAuditPending: number;
  aiAuditCompleted: number;
  hitlPending: number;
  avgSimilarityScore: number;
}

type SimilarityMatchesResponse = Readonly<{
  matches: SimilarityMatchItem[];
  totalCount?: number;
}>;

type PendingCountResponse = Readonly<{
  matches: SimilarityMatchItem[];
  totalCount?: number;
}>;

const SIMILARITY_THRESHOLDS = {
  AUTO_APPROVE: 0.98,
  AI_AUDIT: 0.94,
  HITL_REQUIRED: 0.9,
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function getMatchDetails(match: SimilarityMatchItem): Record<string, unknown> {
  return match.match_details ?? {};
}

function isSourceType(value: string): value is NonNullable<MatchFilters['sourceType']>[number] {
  return value === 'organic' || value === 'shopping' || value === 'knowledge_graph';
}

export function getTriageDecision(match: SimilarityMatchItem): TriageDecision | null {
  const details = getMatchDetails(match);
  const stored = details['triage_decision'];
  if (typeof stored === 'string') {
    if (
      stored === 'auto_approve' ||
      stored === 'ai_audit' ||
      stored === 'hitl_required' ||
      stored === 'rejected'
    ) {
      return stored;
    }
  }
  const score = Number(match.similarity_score);
  if (!Number.isFinite(score)) return null;
  if (score >= SIMILARITY_THRESHOLDS.AUTO_APPROVE) return 'auto_approve';
  if (score >= SIMILARITY_THRESHOLDS.AI_AUDIT) return 'ai_audit';
  if (score >= SIMILARITY_THRESHOLDS.HITL_REQUIRED) return 'hitl_required';
  return 'rejected';
}

export function getScoreBreakdown(match: SimilarityMatchItem): SimilarityScoreBreakdown | null {
  const details = getMatchDetails(match);
  const breakdown = details['scores_breakdown'];
  if (!breakdown || typeof breakdown !== 'object') return null;
  const data = breakdown as Record<string, unknown>;
  const result: SimilarityScoreBreakdown = {};
  if (typeof data['gtinMatch'] === 'number') result.gtinMatch = data['gtinMatch'];
  if (typeof data['titleSimilarity'] === 'number') result.titleSimilarity = data['titleSimilarity'];
  if (typeof data['brandMatch'] === 'number') result.brandMatch = data['brandMatch'];
  if (typeof data['priceProximity'] === 'number') result.priceProximity = data['priceProximity'];
  if (Object.keys(result).length > 0) return result;
  return null;
}

export function getAIAuditResult(match: SimilarityMatchItem): AIAuditResult | null {
  const details = getMatchDetails(match);
  const audit = details['ai_audit_result'];
  if (!audit || typeof audit !== 'object') return null;
  return audit as AIAuditResult;
}

export function hasAIAudit(match: SimilarityMatchItem): boolean {
  return getAIAuditResult(match) !== null;
}

export function requiresHumanReview(match: SimilarityMatchItem): boolean {
  const details = getMatchDetails(match);
  if (details['requires_human_review'] === true) return true;
  return getTriageDecision(match) === 'hitl_required';
}

function applyFilters(
  matches: SimilarityMatchItem[],
  filters: MatchFilters
): SimilarityMatchItem[] {
  const search = filters.search ? normalizeText(filters.search) : null;
  return matches.filter((match) => {
    if (filters.status?.length && !filters.status.includes(match.match_confidence)) return false;
    if (filters.productId && match.product_id !== filters.productId) return false;
    if (filters.matchMethod?.length && !filters.matchMethod.includes(match.match_method))
      return false;
    const triage = getTriageDecision(match);
    if (filters.triageDecision?.length && (!triage || !filters.triageDecision.includes(triage))) {
      return false;
    }
    const score = Number(match.similarity_score);
    if (Number.isFinite(score)) {
      if (filters.similarityMin !== undefined && score < filters.similarityMin) return false;
      if (filters.similarityMax !== undefined && score > filters.similarityMax) return false;
    }
    if (filters.requiresHumanReview !== null && filters.requiresHumanReview !== undefined) {
      if (requiresHumanReview(match) !== filters.requiresHumanReview) return false;
    }
    if (filters.hasAIAudit !== null && filters.hasAIAudit !== undefined) {
      if (hasAIAudit(match) !== filters.hasAIAudit) return false;
    }
    if (search) {
      const haystack = [
        match.product_title,
        match.source_title ?? '',
        match.source_url ?? '',
        match.source_brand ?? '',
      ]
        .filter(Boolean)
        .map((value) => normalizeText(String(value)))
        .join(' ');
      if (!haystack.includes(search)) return false;
    }
    if (filters.sourceType?.length) {
      const source = match.source_data?.['source'];
      if (
        typeof source !== 'string' ||
        !isSourceType(source) ||
        !filters.sourceType.includes(source)
      ) {
        return false;
      }
    }
    if (filters.createdFrom) {
      const created = new Date(match.created_at).getTime();
      const from = new Date(filters.createdFrom).getTime();
      if (Number.isFinite(created) && Number.isFinite(from) && created < from) return false;
    }
    if (filters.createdTo) {
      const created = new Date(match.created_at).getTime();
      const to = new Date(filters.createdTo).getTime();
      if (Number.isFinite(created) && Number.isFinite(to) && created > to) return false;
    }
    return true;
  });
}

export function useSimilarityMatches(filters: MatchFilters) {
  const api = useApiClient();
  const [matches, setMatches] = useState<SimilarityMatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = filters.status?.length === 1 ? filters.status[0] : null;
      const triageDecision =
        filters.triageDecision?.length === 1 ? filters.triageDecision[0] : null;
      const matchMethod = filters.matchMethod?.length === 1 ? filters.matchMethod[0] : null;
      const sourceType = filters.sourceType?.length === 1 ? filters.sourceType[0] : null;
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (triageDecision) params.set('triageDecision', triageDecision);
      if (matchMethod) params.set('matchMethod', matchMethod);
      if (filters.similarityMin !== undefined)
        params.set('similarityMin', String(filters.similarityMin));
      if (filters.similarityMax !== undefined)
        params.set('similarityMax', String(filters.similarityMax));
      if (filters.requiresHumanReview !== null && filters.requiresHumanReview !== undefined) {
        params.set('requiresHumanReview', String(filters.requiresHumanReview));
      }
      if (filters.hasAIAudit !== null && filters.hasAIAudit !== undefined) {
        params.set('hasAIAudit', String(filters.hasAIAudit));
      }
      if (filters.productId) params.set('productId', filters.productId);
      if (filters.search) params.set('search', filters.search);
      if (sourceType) params.set('sourceType', sourceType);
      if (filters.createdFrom) params.set('createdFrom', filters.createdFrom);
      if (filters.createdTo) params.set('createdTo', filters.createdTo);
      params.set('limit', '250');
      params.set('includeCount', 'true');
      const query = params.toString();
      const data = await api.getApi<SimilarityMatchesResponse>(`/similarity-matches?${query}`);
      const rows = data.matches ?? [];
      setMatches(rows);
      setTotalCount(typeof data.totalCount === 'number' ? data.totalCount : null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nu am putut încărca matches.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [api, filters.status]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => applyFilters(matches, filters), [matches, filters]);

  return { matches: filtered, loading, error, reload: load, totalCount };
}

export function useSimilarityMatch(matchId: string | null) {
  const api = useApiClient();
  const [match, setMatch] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .getApi<{ match: Record<string, unknown> }>(`/similarity-matches/${matchId}`)
      .then((data) => {
        if (!cancelled) setMatch(data.match ?? null);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Nu am putut încărca match-ul.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, matchId]);

  return { match, loading, error };
}

export function useSimilarityMatchMutations() {
  const api = useApiClient();

  const updateConfidence = useCallback(
    async (matchId: string, confidence: string, rejectionReason?: string) => {
      await api.getApi(`/similarity-matches/${matchId}/confidence`, {
        method: 'PATCH',
        body: JSON.stringify({ confidence, rejectionReason }),
      });
    },
    [api]
  );

  const markAsPrimary = useCallback(
    async (matchId: string) => {
      await api.getApi(`/similarity-matches/${matchId}/primary`, {
        method: 'PATCH',
      });
    },
    [api]
  );

  const batchUpdateConfidence = useCallback(
    async (matchIds: string[], confidence: string, rejectionReason?: string) => {
      await Promise.all(
        matchIds.map(async (id) => {
          await updateConfidence(id, confidence, rejectionReason);
        })
      );
    },
    [updateConfidence]
  );

  return useMemo(
    () => ({
      updateConfidence,
      markAsPrimary,
      batchUpdateConfidence,
    }),
    [batchUpdateConfidence, markAsPrimary, updateConfidence]
  );
}

export function useSimilarityMatchesStats(matches: SimilarityMatchItem[]): MatchStats {
  return useMemo(() => {
    const total = matches.length;
    let pending = 0;
    let confirmed = 0;
    let rejected = 0;
    let autoApproved = 0;
    let aiAuditPending = 0;
    let aiAuditCompleted = 0;
    let hitlPending = 0;
    let scoreSum = 0;
    let scoreCount = 0;

    matches.forEach((match) => {
      if (match.match_confidence === 'pending') pending += 1;
      if (match.match_confidence === 'confirmed') confirmed += 1;
      if (match.match_confidence === 'rejected') rejected += 1;
      const triage = getTriageDecision(match);
      if (triage === 'auto_approve') autoApproved += 1;
      if (triage === 'ai_audit') {
        if (hasAIAudit(match)) {
          aiAuditCompleted += 1;
        } else {
          aiAuditPending += 1;
        }
      }
      if (triage === 'hitl_required' && match.match_confidence === 'pending') hitlPending += 1;
      const score = Number(match.similarity_score);
      if (Number.isFinite(score)) {
        scoreSum += score;
        scoreCount += 1;
      }
    });

    return {
      total,
      pending,
      confirmed,
      rejected,
      autoApproved,
      aiAuditPending,
      aiAuditCompleted,
      hitlPending,
      avgSimilarityScore: scoreCount > 0 ? scoreSum / scoreCount : 0,
    };
  }, [matches]);
}

export function usePendingSimilarityMatchCount() {
  const api = useApiClient();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.getApi<PendingCountResponse>(
          '/similarity-matches?status=pending&limit=1&includeCount=true'
        );
        if (!cancelled) {
          setCount(
            typeof data.totalCount === 'number' ? data.totalCount : (data.matches?.length ?? 0)
          );
        }
      } catch {
        if (!cancelled) setCount(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [api]);

  return count;
}

export function useHITLQueue() {
  const api = useApiClient();
  const [matches, setMatches] = useState<SimilarityMatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getApi<{ items: SimilarityMatchItem[] }>('/products/review?type=hitl');
      setMatches(data.items ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nu am putut încărca HITL queue.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return { matches, loading, error, reload: load };
}
