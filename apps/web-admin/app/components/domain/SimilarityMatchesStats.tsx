import type { MatchStats } from '../../hooks/use-similarity-matches';
import { InfoTooltip } from '../ui/info-tooltip';

interface SimilarityMatchesStatsProps {
  stats: MatchStats;
}

export function SimilarityMatchesStats({ stats }: SimilarityMatchesStatsProps) {
  return (
    <div className="space-y-4" style={{ animation: 'fadeSlideUp 0.35s ease-out both' }}>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>Total</span>
            <InfoTooltip title="Total potriviri">
              Numărul total de potriviri găsite pentru filtrele active. Contează pentru a evalua
              volumul de lucru rămas. De exemplu, 150 potriviri cu 80 în așteptare. Sfat: filtrează
              pe status pentru a prioriza.
            </InfoTooltip>
          </div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{stats.total}</div>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>În așteptare</span>
            <InfoTooltip title="În așteptare">
              Potrivirile în așteptare nu au fost încă confirmate sau respinse. Necesită atenția ta
              pentru validare. De exemplu, 30 de potriviri noi de azi. Sfat: începe cu cele cu scor
              mare pentru eficiență maximă.
            </InfoTooltip>
          </div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {stats.pending}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>Confirmate</span>
            <InfoTooltip title="Confirmate">
              Potrivirile confirmate sunt validate și datele lor pot fi folosite pentru enrichment.
              Un număr mare indică un catalog bine conectat. De exemplu, 85% confirmate = calitate
              bună. Sfat: monitorizează rata de confirmare pentru a evalua algoritmul.
            </InfoTooltip>
          </div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {stats.confirmed}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>Respinse</span>
            <InfoTooltip title="Respinse">
              Potrivirile respinse au fost marcate ca incorecte sau irelevante. Nu vor fi folosite
              pentru enrichment. De exemplu, produse din categorii diferite. Sfat: o rată mare de
              respingere poate indica nevoie de ajustare prag.
            </InfoTooltip>
          </div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {stats.rejected}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="text-xs text-slate-500 dark:text-slate-400">Auto-aprobate</div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {stats.autoApproved}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="text-xs text-slate-500 dark:text-slate-400">AI Audit în așteptare</div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {stats.aiAuditPending}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="text-xs text-slate-500 dark:text-slate-400">AI Audit finalizat</div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {stats.aiAuditCompleted}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="text-xs text-slate-500 dark:text-slate-400">HITL în așteptare</div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {stats.hitlPending}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            Scor similaritate mediu
            <InfoTooltip title="Scor similaritate mediu">
              Media aritmetică a scorurilor de similaritate ale potrivirilor afișate (0–1). Un scor
              mediu ridicat indică potriviri de calitate. De exemplu, 0.96 mediu = excelent. Sfat:
              dacă media scade sub 0.90, verifică pragul din filtre.
            </InfoTooltip>
          </span>
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {stats.avgSimilarityScore.toFixed(2)}
          </span>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-2 rounded-full bg-blue-500/70 dark:bg-blue-400/70 motion-safe:transition-all motion-safe:duration-300"
            style={{ width: `${Math.min(Math.max(stats.avgSimilarityScore, 0), 1) * 100}%` }}
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
        <div className="text-xs text-slate-500 dark:text-slate-400">Distribuție</div>
        {stats.total === 0 ? (
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Nicio dată încă.</div>
        ) : (
          <>
            <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="bg-emerald-500/70 dark:bg-emerald-400/70"
                style={{ width: `${(stats.autoApproved / stats.total) * 100}%` }}
              />
              <div
                className="bg-blue-500/70 dark:bg-blue-400/70"
                style={{
                  width: `${((stats.aiAuditPending + stats.aiAuditCompleted) / stats.total) * 100}%`,
                }}
              />
              <div
                className="bg-amber-500/70 dark:bg-amber-400/70"
                style={{ width: `${(stats.hitlPending / stats.total) * 100}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span>Auto: {stats.autoApproved}</span>
              <span>AI Audit: {stats.aiAuditPending + stats.aiAuditCompleted}</span>
              <span>HITL: {stats.hitlPending}</span>
            </div>
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="text-xs text-slate-500 dark:text-slate-400">Extracție finalizată</div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {stats.extractionCompleted}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="text-xs text-slate-500 dark:text-slate-400">Extracție în așteptare</div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {stats.extractionPending}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="text-xs text-slate-500 dark:text-slate-400">Extracție în curs</div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {stats.extractionInProgress}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="text-xs text-slate-500 dark:text-slate-400">Rata succes extracție</div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {stats.total > 0 ? Math.round((stats.extractionCompleted / stats.total) * 100) : 0}%
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-white/80 backdrop-blur-sm p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Încredere medie extracție
          </div>
          <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            {stats.avgExtractionConfidence > 0
              ? `${Math.round(stats.avgExtractionConfidence * 100)}%`
              : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
