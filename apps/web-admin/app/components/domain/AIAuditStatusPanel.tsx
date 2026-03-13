import { useRef } from 'react';
import { InfoTooltip } from '../ui/info-tooltip';

interface AIAuditStatusPanelProps {
  auditResult: {
    decision: string;
    confidence: number;
    reasoning: string;
    isSameProduct?: string;
    usableForEnrichment?: string | boolean;
    criticalDiscrepancies?: string[];
    auditedAt?: string;
    modelUsed?: string;
  } | null;
  isProcessing?: boolean;
}

export function AIAuditStatusPanel({ auditResult, isProcessing }: AIAuditStatusPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  if (isProcessing) {
    return (
      <div
        ref={panelRef}
        className="rounded-lg border border-muted/20 bg-subtle p-4 text-sm text-muted
 motion-safe:animate-[fadeIn_0.4s_ease-out]"
      >
        Verificare AI în curs…
      </div>
    );
  }

  if (!auditResult) {
    return (
      <div
        ref={panelRef}
        className="rounded-lg border border-muted/20 bg-subtle p-4 text-sm text-muted
 motion-safe:animate-[fadeIn_0.4s_ease-out]"
      >
        Nu există încă rezultat de audit AI.
      </div>
    );
  }

  const confidencePct = Math.round((auditResult.confidence ?? 0) * 100);
  const confidenceLabel =
    confidencePct >= 85 ? 'ridicat' : confidencePct >= 65 ? 'mediu' : 'scăzut';

  return (
    <div
      ref={panelRef}
      className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 text-foreground
 motion-safe:animate-[fadeSlideUp_0.35s_ease-out]"
    >
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="flex items-center gap-1.5">
          Auditor AI
          <InfoTooltip title="Auditor AI" side="bottom" maxWidth={380} boundaryRef={panelRef}>
            Un model de inteligență artificială analizează potrivirea dintre produsul tău și cel
            găsit. Verifică titluri, descrieri și atribute pentru a recomanda aprobare, revizuire
            umană sau respingere.
          </InfoTooltip>
        </span>
        <span className="flex items-center gap-1.5">
          {auditResult.modelUsed ?? 'grok'}
          <InfoTooltip title="Model folosit" side="bottom" maxWidth={280} boundaryRef={panelRef}>
            Numele modelului de AI care a efectuat analiza. Poate varia în funcție de configurarea
            aplicației.
          </InfoTooltip>
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
        <span>Decizie:</span>
        <span className="text-foreground">{auditResult.decision}</span>
        <InfoTooltip title="Decizie audit" side="bottom" maxWidth={360} boundaryRef={panelRef}>
          Recomandarea AI: aprobare automată, trimitere la revizuire umană sau respingere. Aceasta
          ghidează fluxul de confirmare a potrivirilor.
        </InfoTooltip>
      </div>

      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
        <span>
          Încredere: {confidencePct}% · {confidenceLabel}
        </span>
        <InfoTooltip title="Nivel de încredere" side="bottom" maxWidth={340} boundaryRef={panelRef}>
          Cât de sigur este modelul în recomandarea sa. Ridicat (≥85%) înseamnă analiză clară;
          scăzut (&lt;65%) sugerează că e mai bine să verifici manual.
        </InfoTooltip>
      </div>

      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted/20"
        role="progressbar"
        aria-valuenow={confidencePct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Nivel încredere ${confidencePct}%`}
        title={`Nivel încredere: ${confidencePct}%`}
      >
        <div
          className="h-full rounded-full bg-primary/70 motion-safe:transition-[width_0.5s_ease-out]"
          style={{ width: `${confidencePct}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1">
          Același produs: {auditResult.isSameProduct ?? '—'}
          <InfoTooltip title="Același produs" side="bottom" maxWidth={320} boundaryRef={panelRef}>
            Concluzia AI dacă cele două produse sunt același articol (da/nu/incert). Influențează
            decizia de aprobare.
          </InfoTooltip>
        </span>
        <span>·</span>
        <span className="flex items-center gap-1">
          Utilizabil: {String(auditResult.usableForEnrichment ?? '—')}
          <InfoTooltip
            title="Utilizabil pentru îmbogățire"
            side="bottom"
            maxWidth={340}
            boundaryRef={panelRef}
          >
            Dacă datele din potrivire pot fi folosite pentru îmbogățirea produsului (ex. titlu,
            descriere, specificații). „Da" înseamnă că potrivirea aduce informații utile.
          </InfoTooltip>
        </span>
      </div>

      <div className="mt-3 text-sm text-foreground">{auditResult.reasoning}</div>

      {auditResult.criticalDiscrepancies?.length ? (
        <div className="mt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
            Diferențe importante
            <InfoTooltip
              title="Diferențe importante"
              side="bottom"
              maxWidth={360}
              boundaryRef={panelRef}
            >
              Aspecte în care produsele diferă semnificativ (ex. preț, unitate de măsură, atribut
              lipsă). Merită verificate înainte de aprobare.
            </InfoTooltip>
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
            {auditResult.criticalDiscrepancies.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {auditResult.auditedAt ? (
        <div className="mt-2 text-xs text-muted">Auditat: {auditResult.auditedAt}</div>
      ) : null}
    </div>
  );
}
