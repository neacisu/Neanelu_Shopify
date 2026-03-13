import { useReducedMotion } from '../../hooks/use-reduced-motion';
import { InfoTooltip } from '../ui/info-tooltip';
import { Checkbox } from '../ui/checkbox';
import { TextField } from '../ui/text-field';

type MatchStatus = 'pending' | 'confirmed' | 'rejected' | 'uncertain';
type TriageDecision = 'auto_approve' | 'ai_audit' | 'hitl_required' | 'rejected';
type MatchMethod = 'gtin_exact' | 'mpn_exact' | 'title_fuzzy' | 'vector_semantic';
type SourceType = 'organic' | 'shopping' | 'knowledge_graph';
type ExtractionStatus = 'pending' | 'in_progress' | 'complete' | 'failed';

export interface SimilarityMatchesFilterState {
  status?: MatchStatus[];
  triageDecision?: TriageDecision[];
  matchMethod?: MatchMethod[];
  similarityMin?: number;
  similarityMax?: number;
  requiresHumanReview?: boolean | null;
  hasAIAudit?: boolean | null;
  hasExtraction?: boolean | null;
  extractionStatus?: ExtractionStatus[];
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
const EXTRACTION_STATUS_OPTIONS: ExtractionStatus[] = [
  'pending',
  'in_progress',
  'complete',
  'failed',
];

type StatusOption = MatchStatus;
type MethodOption = MatchMethod;
type SourceOption = SourceType;
type ExtractionStatusOption = ExtractionStatus;

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

function isExtractionStatusOption(value: string): value is ExtractionStatusOption {
  return EXTRACTION_STATUS_OPTIONS.includes(value as ExtractionStatus);
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
  const reducedMotion = useReducedMotion();
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
  const extractionStatusValues = isStringArray(filters.extractionStatus)
    ? filters.extractionStatus.filter(isExtractionStatusOption)
    : [];

  return (
    <div
      className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4"
      style={reducedMotion ? undefined : { animation: 'fadeSlideUp 0.4s ease-out both' }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <span className="inline-flex items-start gap-1.5 text-sm">
          <TextField
            label="Căutare"
            type="text"
            value={filters.search ?? ''}
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
            placeholder="Titlu, URL, brand..."
          />
          <InfoTooltip title="Căutare text">
            Caută text liber în titluri, URL-uri sau brand. Filtrează instantaneu potrivirile
            afișate. De exemplu, scrie „Nike" pentru a vedea doar potrivirile cu acest brand. Sfat:
            poți folosi și fragmente de URL.
          </InfoTooltip>
        </span>

        <span className="inline-flex items-start gap-1.5 text-sm">
          <TextField
            label="Similarity min"
            type="number"
            min={0.9}
            max={1}
            step={0.01}
            value={String(filters.similarityMin ?? 0.9)}
            onChange={(event) =>
              onChange({ ...filters, similarityMin: Number(event.target.value) })
            }
          />
          <InfoTooltip title="Similarity minim">
            Scorul minim de similaritate exclude potrivirile cu scor prea mic. Valoarea implicită e
            0.9 (foarte similare). De exemplu, 0.95 arată doar potriviri aproape identice. Sfat:
            scade la 0.85 dacă vrei mai multe rezultate.
          </InfoTooltip>
        </span>

        <span className="inline-flex items-start gap-1.5 text-sm">
          <TextField
            label="Similarity max"
            type="number"
            min={0.9}
            max={1}
            step={0.01}
            value={String(filters.similarityMax ?? 1)}
            onChange={(event) =>
              onChange({ ...filters, similarityMax: Number(event.target.value) })
            }
          />
          <InfoTooltip title="Similarity maxim">
            Scorul maxim limitează rezultatele. Implicit 1 = include toate. Util dacă vrei să
            excluzi potriviri exacte (1.0). De exemplu, setează 0.99 pentru a investiga doar
            potrivirile parțiale. Sfat: în majoritatea cazurilor, lasă 1.
          </InfoTooltip>
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            Status
            <InfoTooltip title="Filtru status">
              Filtrează potrivirile după statusul de confirmare. Selectează una sau mai multe
              opțiuni simultan. De exemplu, alege „pending" pentru a vedea doar cele neevaluate.
              Sfat: click din nou pentru a deselecta.
            </InfoTooltip>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs transition-colors focus-ring-standard ${
                  statusValues.includes(status)
                    ? 'border-primary/50 bg-primary/5 text-foreground'
                    : 'border-border text-muted hover:bg-subtle'
                }`}
                onClick={() => onChange({ ...filters, status: toggleList(statusValues, status) })}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            Triage
            <InfoTooltip title="Filtru triage">
              Filtrează după decizia de triage automată. Auto-approve = scor mare, AI audit = review
              AI, HITL = review uman necesar. De exemplu, alege „hitl_required" pentru a prioriza.
              Sfat: HITL necesită cel mai mult timp de review.
            </InfoTooltip>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {TRIAGE_OPTIONS.map((triage) => (
              <button
                key={triage}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs transition-colors focus-ring-standard ${
                  triageValues.includes(triage)
                    ? 'border-primary/50 bg-primary/5 text-foreground'
                    : 'border-border text-muted hover:bg-subtle'
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
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            Metodă potrivire
            <InfoTooltip title="Filtru metodă potrivire">
              Filtrează după cum a fost găsită potrivirea. GTIN = cod de bare, MPN = cod producător,
              fuzzy = titlu similar, semantic = AI vector. De exemplu, GTIN exact e cea mai fiabilă.
              Sfat: combină metoda cu scor pentru analiză precisă.
            </InfoTooltip>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {METHOD_OPTIONS.map((method) => (
              <button
                key={method}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  methodValues.includes(method)
                    ? 'border-primary/50 bg-primary/5 text-foreground'
                    : 'border-border text-muted hover:bg-subtle'
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
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            Tip sursă
            <InfoTooltip title="Filtru tip sursă">
              Filtrează după tipul sursei externe. Organic = rezultate web, Shopping = Google
              Shopping, Knowledge Graph = date structurate. De exemplu, Shopping conține de obicei
              prețuri exacte. Sfat: combină cu metoda pentru filtrare avansată.
            </InfoTooltip>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {SOURCE_OPTIONS.map((source) => (
              <button
                key={source}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  sourceValues.includes(source)
                    ? 'border-primary/50 bg-primary/5 text-foreground'
                    : 'border-border text-muted hover:bg-subtle'
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
          <span className="flex items-center gap-1.5 text-muted">
            Creat de la
            <InfoTooltip title="Dată de început">
              Filtrează potrivirile create după această dată. Util pentru a vedea doar cele recente.
              De exemplu, setează data de ieri pentru potrivirile noi. Sfat: combină cu „Creat până
              la" pentru un interval precis.
            </InfoTooltip>
          </span>
          <input
            type="date"
            value={filters.createdFrom ?? ''}
            onChange={(event) => onChange({ ...filters, createdFrom: event.target.value })}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-foreground transition-shadow duration-200 focus-ring-standard focus:outline-none"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="flex items-center gap-1.5 text-muted">
            Creat până la
            <InfoTooltip title="Dată de sfârșit">
              Filtrează potrivirile create înainte de această dată. Util pentru analiza unui
              interval specific. De exemplu, doar potrivirile din ultima săptămână. Sfat: lasă gol
              pentru a include toate până la azi.
            </InfoTooltip>
          </span>
          <input
            type="date"
            value={filters.createdTo ?? ''}
            onChange={(event) => onChange({ ...filters, createdTo: event.target.value })}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-foreground transition-shadow duration-200 focus-ring-standard focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-foreground">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={filters.hasAIAudit === true}
            aria-label="Filtru doar cu AI audit"
            onChange={(event) =>
              onChange({ ...filters, hasAIAudit: event.target.checked ? true : null })
            }
          />
          Doar cu AI audit
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={filters.hasExtraction === true}
            aria-label="Filtru doar cu extracție"
            onChange={(event) =>
              onChange({ ...filters, hasExtraction: event.target.checked ? true : null })
            }
          />
          Doar cu extracție
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={filters.requiresHumanReview === true}
            aria-label="Filtru necesită review uman"
            onChange={(event) =>
              onChange({ ...filters, requiresHumanReview: event.target.checked ? true : null })
            }
          />
          Necesită review uman
        </label>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-border px-3 py-1 text-xs text-muted transition-colors hover:bg-subtle focus-ring-standard"
        >
          Reset filtre
        </button>
      </div>

      <div className="mt-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          Status extracție
          <InfoTooltip title="Filtru status extracție">
            Filtrează după statusul extracției de date. Pending = neinceput, in_progress = în curs,
            complete = finalizat, failed = eșuat. De exemplu, alege „failed" pentru a investiga
            erorile. Sfat: „complete" arată potrivirile cu date deja extrase.
          </InfoTooltip>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXTRACTION_STATUS_OPTIONS.map((status) => (
            <button
              key={status}
              type="button"
              className={`rounded-full border px-3 py-1 text-xs transition-colors focus-ring-standard ${
                extractionStatusValues.includes(status)
                  ? 'border-primary/50 bg-primary/5 text-foreground'
                  : 'border-border text-muted hover:bg-subtle'
              }`}
              onClick={() =>
                onChange({
                  ...filters,
                  extractionStatus: toggleList(extractionStatusValues, status),
                })
              }
            >
              {status}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
