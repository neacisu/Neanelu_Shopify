import { Button } from '../ui/button';
import { Drawer } from '../ui/drawer';
import { InfoTooltip } from '../ui/info-tooltip';
import { AIAuditStatusPanel } from './AIAuditStatusPanel';
import { ExtractionStatusBadge } from './ExtractionStatusBadge';
import { MatchStatusBadge } from './MatchStatusBadge';
import { TriageStatusBadge } from './TriageStatusBadge';

import type { SimilarityMatchItem } from '../../hooks/use-similarity-matches';
import {
  getExtractionConfidence,
  getExtractionFieldsUncertain,
  getExtractionStatus,
  getAIAuditResult,
  getScoreBreakdown,
  getTriageDecision,
  type ExtractionStatus,
} from '../../hooks/use-similarity-matches';

interface SimilarityMatchDetailDrawerProps {
  match: SimilarityMatchItem | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onMarkAsPrimary?: () => void;
  onExtract?: () => void;
  extractionStatusOverride?: ExtractionStatus;
  isExtracting?: boolean;
  extractionError?: string | null;
}

export function SimilarityMatchDetailDrawer({
  match,
  isOpen,
  onClose,
  onConfirm,
  onReject,
  onMarkAsPrimary,
  onExtract,
  extractionStatusOverride,
  isExtracting,
  extractionError,
}: SimilarityMatchDetailDrawerProps) {
  if (!isOpen || !match) return null;
  const breakdown = getScoreBreakdown(match);
  const triage = getTriageDecision(match);
  const audit = getAIAuditResult(match);
  const extractionStatus = extractionStatusOverride ?? getExtractionStatus(match);
  const extractionConfidence = getExtractionConfidence(match);
  const extractionFieldsUncertain = getExtractionFieldsUncertain(match);
  const details = match.match_details ?? {};
  const specs = Array.isArray(match.specs_extracted?.['specifications'])
    ? (match.specs_extracted?.['specifications'] as Record<string, unknown>[])
    : [];
  const specsPreview = specs.slice(0, 3);
  const timeline = [
    { label: 'Creat', value: match.created_at },
    {
      label: 'Triage',
      value: typeof details['triage_timestamp'] === 'string' ? details['triage_timestamp'] : null,
    },
    {
      label: 'AI Audit programat',
      value:
        typeof details['ai_audit_scheduled_at'] === 'string'
          ? details['ai_audit_scheduled_at']
          : null,
    },
    {
      label: 'AI Audit finalizat',
      value:
        typeof details['ai_audit_completed_at'] === 'string'
          ? details['ai_audit_completed_at']
          : null,
    },
  ].filter((item) => item.value);

  return (
    <Drawer open={isOpen} onClose={onClose} title="Detalii potrivire" side="right" size="xl">
      <div className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted">
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
          {triage ? <TriageStatusBadge status={triage} /> : null}
          <span>Scor: {Number(match.similarity_score).toFixed(2)}</span>
        </div>{' '}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-3 transition-colors hover:border-border">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              Produs local
              <InfoTooltip title="Produs local">
                Produsul din catalogul tău căruia i s-a găsit această potrivire externă. Verifică
                dacă titlul și imaginea corespund cu sursa. De exemplu, compară brandul și
                categoria. Sfat: click pe „Vezi sursa" pentru a compara vizual pe site-ul extern.
              </InfoTooltip>
            </div>
            <div className="mt-3 flex items-center gap-3">
              {match.product_image ? (
                <img
                  src={match.product_image}
                  alt={match.product_title}
                  className="h-14 w-14 rounded object-cover"
                />
              ) : (
                <div className="h-14 w-14 rounded bg-subtle" />
              )}
              <div>
                <div className="text-sm font-medium text-foreground">{match.product_title}</div>
                <div className="text-xs text-muted">PIM ID: {match.product_id}</div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-3 transition-colors hover:border-border">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              Sursă externă
              <InfoTooltip title="Sursă externă">
                Produsul găsit pe site-uri externe care se potrivește cu al tău. Include detalii
                precum brand, GTIN și preț. De exemplu, verifică dacă prețul sursei e în aceeași
                gamă. Sfat: GTIN identic = cea mai fiabilă potrivire.
              </InfoTooltip>
            </div>
            <div className="mt-3 space-y-1 text-sm">
              <div className="font-medium text-foreground">
                {match.source_title ?? match.source_url}
              </div>
              <div className="text-xs text-muted">{match.source_url}</div>
              <div className="text-xs text-muted">Brand: {match.source_brand ?? '—'}</div>
              <div className="text-xs text-muted">GTIN: {match.source_gtin ?? '—'}</div>
              <div className="text-xs text-muted">
                Preț: {match.source_price ?? '—'} {match.source_currency ?? ''}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-card/80 backdrop-blur-sm p-3 transition-colors hover:border-border">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            Detalii scor similaritate
            <InfoTooltip title="Detalii scor">
              Scorul total se calculează din mai multe componente. Fiecare componentă contribuie la
              scorul final. De exemplu, GTIN identic adaugă ponderea maximă. Sfat: scoruri cu brand
              match ridicat dar GTIN absent necesită atenție suplimentară.
            </InfoTooltip>
          </div>
          {breakdown ? (
            <div className="mt-3 grid gap-2 text-xs text-muted">
              <div>GTIN: {breakdown.gtinMatch ?? '—'}</div>
              <div>Titlu: {breakdown.titleSimilarity ?? '—'}</div>
              <div>Brand: {breakdown.brandMatch ?? '—'}</div>
              <div>Preț: {breakdown.priceProximity ?? '—'}</div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted">Detalii indisponibile.</div>
          )}
        </div>
        <div className="mt-4">
          <AIAuditStatusPanel auditResult={audit} isProcessing={triage === 'ai_audit' && !audit} />
        </div>
        <div className="mt-4 rounded-lg border border-border bg-card/80 backdrop-blur-sm p-3 transition-colors hover:border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              Extracție
              <InfoTooltip title="Extracție date">
                Extracția colectează date (specificații, preț, brand) din sursa externă. Contează
                pentru enrichment-ul produselor tale cu informații de piață. De exemplu, se extrag
                greutatea, dimensiunile și materialul. Sfat: la aprobare prin AI Audit, extracția
                pornește automat.
              </InfoTooltip>
            </div>
            <ExtractionStatusBadge status={extractionStatus} />
          </div>
          <div className="mt-2 grid gap-2 text-xs text-muted">
            <div>Sesiune: {match.extraction_session_id ?? '—'}</div>
            <div>Ultim scrap: {match.scraped_at ?? '—'}</div>
            <div>
              Încredere:{' '}
              {extractionConfidence !== null ? `${Math.round(extractionConfidence * 100)}%` : '—'}
            </div>
            {extractionFieldsUncertain.length ? (
              <div>Câmpuri incerte: {extractionFieldsUncertain.join(', ')}</div>
            ) : null}
            {specs.length ? (
              <div>
                Specs: {specs.length} ·{' '}
                {specsPreview
                  .map((item) => {
                    const name = typeof item['name'] === 'string' ? item['name'] : 'spec';
                    const value = typeof item['value'] === 'string' ? item['value'] : '';
                    return value ? `${name}: ${value}` : name;
                  })
                  .join(', ')}
                {specs.length > specsPreview.length ? '…' : ''}
              </div>
            ) : (
              <div>Specs: —</div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onExtract ? (
              <span className="inline-flex items-center gap-1.5">
                <Button size="sm" variant="secondary" onClick={onExtract} disabled={isExtracting}>
                  {isExtracting ? 'Se rulează...' : 'Extrage acum'}
                </Button>
                <InfoTooltip title="Extrage acum" side="bottom">
                  Pornește manual extracția de date din sursa externă. Procesul durează câteva
                  secunde. De exemplu, se scrapează pagina și se extrag specificațiile. Sfat: nu e
                  nevoie să extragi manual dacă AI Audit aprobă automat.
                </InfoTooltip>
              </span>
            ) : null}
            <span className="text-xs text-muted">
              La aprobare prin AI Audit, extracția pornește automat.
            </span>
          </div>
          {extractionError ? (
            <div className="mt-2 text-xs text-error">{extractionError}</div>
          ) : null}
        </div>
        {timeline.length > 0 ? (
          <div className="mt-4 rounded-lg border border-border bg-card/80 backdrop-blur-sm p-3 transition-colors hover:border-border">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              Cronologie
              <InfoTooltip title="Cronologie">
                Cronologia arată evenimentele importante din viața potrivirii. Include momentele de
                creare, triage, programare și finalizare AI Audit. De exemplu, vezi cât a durat de
                la creare la aprobare. Sfat: dacă AI Audit durează mult, verifică coada de
                procesare.
              </InfoTooltip>
            </div>
            <div className="mt-2 space-y-1 text-xs text-muted">
              {timeline.map((item) => (
                <div key={item.label}>
                  {item.label}: {String(item.value)}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1">
            <Button size="sm" variant="secondary" onClick={onConfirm}>
              Confirmă
            </Button>
            <InfoTooltip title="Confirmă potrivirea" side="bottom">
              Marchează potrivirea ca validă. Datele sursei pot fi folosite pentru enrichment.
              Verifică înainte că titlul și brandul corespund. Sfat: nu mai poți anula după
              confirmare, dar poți marca altă sursă ca primară.
            </InfoTooltip>
          </span>
          <span className="inline-flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={onReject}>
              Respinge
            </Button>
            <InfoTooltip title="Respinge potrivirea" side="bottom">
              Marchează potrivirea ca invalidă. Sursa nu va fi folosită pentru enrichment. Util când
              produsul e diferit sau datele sunt incorecte. Sfat: respingerile ajută AI-ul să învețe
              ce nu e relevant.
            </InfoTooltip>
          </span>
          {onMarkAsPrimary ? (
            <span className="inline-flex items-center gap-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={onMarkAsPrimary}
                disabled={match.match_confidence !== 'confirmed'}
              >
                Marchează ca primar
              </Button>
              <InfoTooltip title="Marchează ca primar" side="bottom">
                Setează această sursă ca sursa principală de enrichment pentru produs. Doar o
                potrivire confirmată poate fi primară. De exemplu, alege sursa cu cel mai mare scor.
                Sfat: disponibil doar după confirmare.
              </InfoTooltip>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                window.open(match.source_url, '_blank', 'noopener,noreferrer');
              }}
            >
              Vezi sursa
            </Button>
            <InfoTooltip title="Vezi sursa" side="bottom">
              Deschide pagina sursei externe într-un tab nou. Util pentru verificare vizuală a
              produsului. De exemplu, compară imaginile și prețul. Sfat: verifică dacă pagina e încă
              activă.
            </InfoTooltip>
          </span>
        </div>
      </div>
    </Drawer>
  );
}
