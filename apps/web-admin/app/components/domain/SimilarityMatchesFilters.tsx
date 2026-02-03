type MatchStatus = 'pending' | 'confirmed' | 'rejected' | 'uncertain';
type TriageDecision = 'auto_approve' | 'ai_audit' | 'hitl_required' | 'rejected';
type MatchMethod = 'gtin_exact' | 'mpn_exact' | 'title_fuzzy' | 'vector_semantic';
type SourceType = 'organic' | 'shopping' | 'knowledge_graph';

export interface SimilarityMatchesFilterState {
  status?: MatchStatus[];
  triageDecision?: TriageDecision[];
  matchMethod?: MatchMethod[];
  similarityMin?: number;
  similarityMax?: number;
  requiresHumanReview?: boolean | null;
  hasAIAudit?: boolean | null;
  productId?: string;
  search?: string;
  sourceType?: SourceType[];
  createdFrom?: string;
  createdTo?: string;
}

interface SimilarityMatchesFiltersProps {
  filters: SimilarityMatchesFilterState;
  onChange: (filters: SimilarityMatchesFilterState) => void;
  onClear: () => void;
}

const STATUS_OPTIONS: MatchStatus[] = ['pending', 'confirmed', 'rejected', 'uncertain'];
const TRIAGE_OPTIONS: TriageDecision[] = ['auto_approve', 'ai_audit', 'hitl_required', 'rejected'];
const METHOD_OPTIONS: MatchMethod[] = ['gtin_exact', 'mpn_exact', 'title_fuzzy', 'vector_semantic'];
const SOURCE_OPTIONS: SourceType[] = ['organic', 'shopping', 'knowledge_graph'];

type StatusOption = MatchStatus;
type MethodOption = MatchMethod;
type SourceOption = SourceType;

function isStatusOption(value: string): value is StatusOption {
  return STATUS_OPTIONS.includes(value as MatchStatus);
}

function isTriageOption(value: string): value is TriageDecision {
  return TRIAGE_OPTIONS.includes(value as TriageDecision);
}

function isMethodOption(value: string): value is MethodOption {
  return METHOD_OPTIONS.includes(value as MatchMethod);
}

function isSourceOption(value: string): value is SourceOption {
  return SOURCE_OPTIONS.includes(value as SourceType);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function toggleList<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function SimilarityMatchesFilters({
  filters,
  onChange,
  onClear,
}: SimilarityMatchesFiltersProps) {
  const statusValues = isStringArray(filters.status) ? filters.status.filter(isStatusOption) : [];
  const triageValues = isStringArray(filters.triageDecision)
    ? filters.triageDecision.filter(isTriageOption)
    : [];
  const methodValues = isStringArray(filters.matchMethod)
    ? filters.matchMethod.filter(isMethodOption)
    : [];
  const sourceValues = isStringArray(filters.sourceType)
    ? filters.sourceType.filter(isSourceOption)
    : [];

  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Căutare</span>
          <input
            type="text"
            value={filters.search ?? ''}
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
            placeholder="Titlu, URL, brand..."
            className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Similarity min</span>
          <input
            type="number"
            min={0.9}
            max={1}
            step={0.01}
            value={filters.similarityMin ?? 0.9}
            onChange={(event) =>
              onChange({ ...filters, similarityMin: Number(event.target.value) })
            }
            className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Similarity max</span>
          <input
            type="number"
            min={0.9}
            max={1}
            step={0.01}
            value={filters.similarityMax ?? 1}
            onChange={(event) =>
              onChange({ ...filters, similarityMax: Number(event.target.value) })
            }
            className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <div className="text-xs font-semibold text-muted">Status</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs ${
                  statusValues.includes(status)
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-muted/20 text-muted hover:bg-muted/10'
                }`}
                onClick={() => onChange({ ...filters, status: toggleList(statusValues, status) })}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-muted">Triage</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {TRIAGE_OPTIONS.map((triage) => (
              <button
                key={triage}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs ${
                  triageValues.includes(triage)
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-muted/20 text-muted hover:bg-muted/10'
                }`}
                onClick={() =>
                  onChange({ ...filters, triageDecision: toggleList(triageValues, triage) })
                }
              >
                {triage}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-muted">Match Method</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {METHOD_OPTIONS.map((method) => (
              <button
                key={method}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs ${
                  methodValues.includes(method)
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-muted/20 text-muted hover:bg-muted/10'
                }`}
                onClick={() =>
                  onChange({ ...filters, matchMethod: toggleList(methodValues, method) })
                }
              >
                {method}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <div className="text-xs font-semibold text-muted">Source Type</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {SOURCE_OPTIONS.map((source) => (
              <button
                key={source}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs ${
                  sourceValues.includes(source)
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-muted/20 text-muted hover:bg-muted/10'
                }`}
                onClick={() =>
                  onChange({ ...filters, sourceType: toggleList(sourceValues, source) })
                }
              >
                {source}
              </button>
            ))}
          </div>
        </div>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Created from</span>
          <input
            type="date"
            value={filters.createdFrom ?? ''}
            onChange={(event) => onChange({ ...filters, createdFrom: event.target.value })}
            className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Created to</span>
          <input
            type="date"
            value={filters.createdTo ?? ''}
            onChange={(event) => onChange({ ...filters, createdTo: event.target.value })}
            className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.hasAIAudit === true}
            onChange={(event) =>
              onChange({ ...filters, hasAIAudit: event.target.checked ? true : null })
            }
          />
          Doar cu AI audit
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.requiresHumanReview === true}
            onChange={(event) =>
              onChange({ ...filters, requiresHumanReview: event.target.checked ? true : null })
            }
          />
          Necesită review uman
        </label>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-muted/20 px-3 py-1 text-xs text-muted hover:bg-muted/10"
        >
          Reset filtre
        </button>
      </div>
    </div>
  );
}
