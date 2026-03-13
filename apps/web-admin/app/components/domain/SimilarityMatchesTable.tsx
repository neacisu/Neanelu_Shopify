import { useReducedMotion } from '../../hooks/use-reduced-motion';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { InfoTooltip } from '../ui/info-tooltip';
import { ExtractionStatusBadge } from './ExtractionStatusBadge';
import { MatchStatusBadge } from './MatchStatusBadge';
import { TriageStatusBadge } from './TriageStatusBadge';

import type { SimilarityMatchItem } from '../../hooks/use-similarity-matches';
import {
  getExtractionStatus,
  getScoreBreakdown,
  getTriageDecision,
  type ExtractionStatus,
} from '../../hooks/use-similarity-matches';

interface SimilarityMatchesTableProps {
  matches: SimilarityMatchItem[];
  selectedIds: string[];
  onToggleSelect: (matchId: string) => void;
  onToggleSelectAll: (matchIds: string[]) => void;
  onConfirm: (matchId: string) => void;
  onReject: (matchId: string) => void;
  onRowClick?: (match: SimilarityMatchItem) => void;
  sortBy: { key: 'score' | 'created' | 'product'; direction: 'asc' | 'desc' };
  onSortChange: (sort: { key: 'score' | 'created' | 'product'; direction: 'asc' | 'desc' }) => void;
  extractionStatusMap?: Record<string, ExtractionStatus>;
}

export function SimilarityMatchesTable({
  matches,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onConfirm,
  onReject,
  onRowClick,
  sortBy,
  onSortChange,
  extractionStatusMap,
}: SimilarityMatchesTableProps) {
  const reducedMotion = useReducedMotion();
  const allSelected = matches.length > 0 && selectedIds.length === matches.length;
  const toggleSort = (key: 'score' | 'created' | 'product') => {
    if (sortBy.key === key) {
      onSortChange({ key, direction: sortBy.direction === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ key, direction: 'desc' });
    }
  };

  return (
    <div
      className="overflow-x-auto rounded-lg border border-border bg-card/80 backdrop-blur-sm"
      style={reducedMotion ? undefined : { animation: 'fadeSlideUp 0.35s ease-out both' }}
    >
      <table className="min-w-full text-sm">
        <thead className="bg-subtle text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-3">
              <Checkbox
                checked={allSelected}
                aria-label="Selectează toate potrivirile"
                onChange={() => onToggleSelectAll(matches.map((item) => item.id))}
              />
            </th>
            <th className="px-4 py-3">
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleSort('product')}
                  className="flex items-center gap-1 transition-colors hover:text-foreground"
                  aria-label="Sortează după Produs"
                >
                  Produs
                </button>
                <InfoTooltip title="Produs local">
                  Produsul din catalogul tău căruia i s-a găsit o potrivire externă. Contează pentru
                  a vedea care produse au surse de enrichment. De exemplu, „Adidas Superstar"
                  potrivit cu o listare Google Shopping. Sfat: click pe antet pentru a sorta
                  alfabetic.
                </InfoTooltip>
              </span>
            </th>
            <th className="px-4 py-3">
              <span className="flex items-center gap-1">
                Sursă
                <InfoTooltip title="Sursă externă">
                  Produsul găsit pe site-uri externe (Google Shopping, etc.) care se potrivește cu
                  produsul tău. Util pentru a verifica vizual dacă potrivirea e corectă. De exemplu,
                  compară titlul și prețul sursei cu produsul local. Sfat: click pe rând deschide
                  detalii complete.
                </InfoTooltip>
              </span>
            </th>
            <th className="px-4 py-3">
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleSort('score')}
                  className="flex items-center gap-1 transition-colors hover:text-foreground"
                  aria-label="Sortează după Scor"
                >
                  Scor
                </button>
                <InfoTooltip title="Scor similaritate">
                  Cât de bine se potrivește sursa externă cu produsul tău (0–1). Scor mai mare =
                  potrivire mai bună. De exemplu, 0.98 indică aproape certitudine. Sfat: sortează
                  descrescător ca să vezi cele mai sigure potriviri primele.
                </InfoTooltip>
              </span>
            </th>
            <th className="px-4 py-3">
              <span className="flex items-center gap-1">
                Metodă
                <InfoTooltip title="Metodă potrivire">
                  Metoda indică cum a fost găsită potrivirea. GTIN exact = cod de bare identic, MPN
                  = cod producător, fuzzy = titlu similar, semantic = AI. De exemplu, potrivirile
                  GTIN sunt cele mai fiabile. Sfat: filtrează pe metodă pentru analiza calității.
                </InfoTooltip>
              </span>
            </th>
            <th className="px-4 py-3">
              <span className="flex items-center gap-1">
                Status
                <InfoTooltip title="Status potrivire">
                  Arată dacă potrivirea a fost confirmată, respinsă sau e în așteptare. Este
                  important pentru workflow-ul de validare. De exemplu, „confirmat" înseamnă că
                  datele pot fi folosite. Sfat: filtrează pe „pending" pentru a vedea ce trebuie
                  evaluat.
                </InfoTooltip>
              </span>
            </th>
            <th className="px-4 py-3">
              <span className="flex items-center gap-1">
                Extracție
                <InfoTooltip title="Status extracție">
                  Indică dacă datele (specs, preț) au fost extrase din sursa externă. Extracția
                  adaugă date valoroase la produsul tău. De exemplu, specificații tehnice sau
                  prețuri de piață. Sfat: extracția pornește automat la aprobare AI Audit.
                </InfoTooltip>
              </span>
            </th>
            <th className="px-4 py-3">
              <span className="flex items-center gap-1">
                Triage
                <InfoTooltip title="Decizie triage">
                  Clasificarea automată: auto-aprobat (scor mare), AI review, review uman sau
                  respins. Determină fluxul de validare al potrivirii. De exemplu, HITL înseamnă că
                  AI-ul nu e sigur. Sfat: prioritizează HITL peste AI Audit.
                </InfoTooltip>
              </span>
            </th>
            <th className="px-4 py-3">
              <span className="flex items-center gap-1">
                Acțiuni
                <InfoTooltip title="Acțiuni rapide">
                  Confirmă sau respinge potrivirea direct din tabel, fără a deschide detalii. Util
                  pentru procesare rapidă. De exemplu, confirmă rapid potrivirile cu scor &gt; 0.98.
                  Sfat: selectează mai multe și folosește acțiunile în grup.
                </InfoTooltip>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match, idx) => (
            <tr
              key={match.id}
              className="table-row-interactive cursor-pointer border-t border-border transition-colors duration-200 hover:bg-subtle"
              style={
                reducedMotion
                  ? undefined
                  : { animation: `fadeSlideUp 0.3s ease-out ${idx * 50}ms both` }
              }
              onClick={() => onRowClick?.(match)}
            >
              <td className="px-4 py-3">
                <Checkbox
                  checked={selectedIds.includes(match.id)}
                  aria-label={`Selectează match pentru ${match.product_title}`}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleSelect(match.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {match.product_image ? (
                    <img
                      src={match.product_image}
                      alt={match.product_title}
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-subtle" />
                  )}
                  <div>
                    <div className="text-sm text-foreground">{match.product_title}</div>
                    <div className="text-xs text-muted">{match.source_brand ?? '—'}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-foreground">
                  {match.source_title ?? match.source_url}
                </div>
                <div className="text-xs text-muted">{match.source_url}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-foreground">
                  {Number(match.similarity_score).toFixed(2)}
                </div>
                <div className="mt-1 h-1.5 w-24 rounded-full bg-subtle">
                  <div
                    className="h-1.5 rounded-full bg-primary/70"
                    style={{ width: `${Math.min(Number(match.similarity_score) * 100, 100)}%` }}
                  />
                </div>
                {getScoreBreakdown(match) ? (
                  <div className="mt-1 text-xs text-muted">Detalii scor</div>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-subtle px-2 py-1 text-xs text-foreground">
                  {match.match_method}
                </span>
              </td>
              <td className="px-4 py-3">
                <MatchStatusBadge
                  status={
                    match.match_confidence === 'pending' ||
                    match.match_confidence === 'confirmed' ||
                    match.match_confidence === 'rejected' ||
                    match.match_confidence === 'uncertain'
                      ? match.match_confidence
                      : 'pending'
                  }
                />
              </td>
              <td className="px-4 py-3">
                <ExtractionStatusBadge
                  status={extractionStatusMap?.[match.id] ?? getExtractionStatus(match)}
                />
              </td>
              <td className="px-4 py-3">
                {getTriageDecision(match) ? (
                  <TriageStatusBadge status={getTriageDecision(match) ?? 'rejected'} />
                ) : (
                  <span className="text-xs text-muted">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(event) => {
                      event.stopPropagation();
                      onConfirm(match.id);
                    }}
                  >
                    Confirmă
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      onReject(match.id);
                    }}
                  >
                    Respinge
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {matches.length === 0 ? (
            <tr>
              <td className="px-4 py-6 text-center text-sm text-muted" colSpan={9}>
                Nu există matches pentru filtrul curent. Încearcă să ajustezi filtrele.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
