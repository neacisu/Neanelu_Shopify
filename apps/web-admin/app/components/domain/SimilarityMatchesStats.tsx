import type { MatchStats } from '../../hooks/use-similarity-matches';
import { useReducedMotion } from '../../hooks/use-reduced-motion';
import { InfoTooltip } from '../ui/info-tooltip';

interface SimilarityMatchesStatsProps {
  stats: MatchStats;
}

export function SimilarityMatchesStats({ stats }: SimilarityMatchesStatsProps) {
  const reducedMotion = useReducedMotion();
  return (
    <div
      className="space-y-4"
      style={reducedMotion ? undefined : { animation: 'fadeSlideUp 0.35s ease-out both' }}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span>Total</span>
            <InfoTooltip title="Total potriviri">
              Numărul total de potriviri găsite pentru filtrele active. Contează pentru a evalua
              volumul de lucru rămas. De exemplu, 150 potriviri cu 80 în așteptare. Sfat: filtrează
              pe status pentru a prioriza.
            </InfoTooltip>
          </div>
          <div className="text-2xl font-bold text-foreground">{stats.total}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span>În așteptare</span>
            <InfoTooltip title="În așteptare">
              Potrivirile în așteptare nu au fost încă confirmate sau respinse. Necesită atenția ta
              pentru validare. De exemplu, 30 de potriviri noi de azi. Sfat: începe cu cele cu scor
              mare pentru eficiență maximă.
            </InfoTooltip>
          </div>
          <div className="text-2xl font-bold text-foreground">{stats.pending}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span>Confirmate</span>
            <InfoTooltip title="Confirmate">
              Potrivirile confirmate sunt validate și datele lor pot fi folosite pentru enrichment.
              Un număr mare indică un catalog bine conectat. De exemplu, 85% confirmate = calitate
              bună. Sfat: monitorizează rata de confirmare pentru a evalua algoritmul.
            </InfoTooltip>
          </div>
          <div className="text-2xl font-bold text-foreground">{stats.confirmed}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span>Respinse</span>
            <InfoTooltip title="Respinse">
              Potrivirile respinse au fost marcate ca incorecte sau irelevante. Nu vor fi folosite
              pentru enrichment. De exemplu, produse din categorii diferite. Sfat: o rată mare de
              respingere poate indica nevoie de ajustare prag.
            </InfoTooltip>
          </div>
          <div className="text-2xl font-bold text-foreground">{stats.rejected}</div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="text-xs text-muted">Auto-aprobate</div>
          <div className="text-2xl font-bold text-foreground">{stats.autoApproved}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="text-xs text-muted">AI Audit în așteptare</div>
          <div className="text-2xl font-bold text-foreground">{stats.aiAuditPending}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="text-xs text-muted">AI Audit finalizat</div>
          <div className="text-2xl font-bold text-foreground">{stats.aiAuditCompleted}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="text-xs text-muted">HITL în așteptare</div>
          <div className="text-2xl font-bold text-foreground">{stats.hitlPending}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="flex items-center gap-1.5">
            Scor similaritate mediu
            <InfoTooltip title="Scor similaritate mediu">
              Media aritmetică a scorurilor de similaritate ale potrivirilor afișate (0–1). Un scor
              mediu ridicat indică potriviri de calitate. De exemplu, 0.96 mediu = excelent. Sfat:
              dacă media scade sub 0.90, verifică pragul din filtre.
            </InfoTooltip>
          </span>
          <span className="font-medium text-foreground">{stats.avgSimilarityScore.toFixed(2)}</span>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-subtle">
          <div
            className="h-2 rounded-full bg-primary/70 motion-safe:transition-all motion-safe:duration-300"
            style={{ width: `${Math.min(Math.max(stats.avgSimilarityScore, 0), 1) * 100}%` }}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
        <div className="text-xs text-muted">Distribuție</div>
        {stats.total === 0 ? (
          <div className="mt-2 text-xs text-muted">Nicio dată încă.</div>
        ) : (
          <>
            <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-subtle">
              <div
                className="bg-success/70"
                style={{ width: `${(stats.autoApproved / stats.total) * 100}%` }}
              />
              <div
                className="bg-primary/70"
                style={{
                  width: `${((stats.aiAuditPending + stats.aiAuditCompleted) / stats.total) * 100}%`,
                }}
              />
              <div
                className="bg-warning/70"
                style={{ width: `${(stats.hitlPending / stats.total) * 100}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
              <span>Auto: {stats.autoApproved}</span>
              <span>AI Audit: {stats.aiAuditPending + stats.aiAuditCompleted}</span>
              <span>HITL: {stats.hitlPending}</span>
            </div>
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="text-xs text-muted">Extracție finalizată</div>
          <div className="text-2xl font-bold text-foreground">{stats.extractionCompleted}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="text-xs text-muted">Extracție în așteptare</div>
          <div className="text-2xl font-bold text-foreground">{stats.extractionPending}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="text-xs text-muted">Extracție în curs</div>
          <div className="text-2xl font-bold text-foreground">{stats.extractionInProgress}</div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="text-xs text-muted">Rata succes extracție</div>
          <div className="text-2xl font-bold text-foreground">
            {stats.total > 0 ? Math.round((stats.extractionCompleted / stats.total) * 100) : 0}%
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4">
          <div className="text-xs text-muted">Încredere medie extracție</div>
          <div className="text-2xl font-bold text-foreground">
            {stats.avgExtractionConfidence > 0
              ? `${Math.round(stats.avgExtractionConfidence * 100)}%`
              : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
