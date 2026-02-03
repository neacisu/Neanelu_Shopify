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
  if (isProcessing) {
    return (
      <div className="rounded-lg border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
        AI Audit în procesare...
      </div>
    );
  }

  if (!auditResult) {
    return (
      <div className="rounded-lg border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
        Nu există încă rezultat AI Audit.
      </div>
    );
  }

  const confidencePct = Math.round((auditResult.confidence ?? 0) * 100);
  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>AI Auditor</span>
        <span>{auditResult.modelUsed ?? 'grok'}</span>
      </div>
      <div className="mt-2 text-sm font-semibold">Decision: {auditResult.decision}</div>
      <div className="mt-1 text-xs text-muted">Confidence: {confidencePct}%</div>
      <div className="mt-2 h-2 w-full rounded-full bg-muted/10">
        <div className="h-2 rounded-full bg-blue-500/70" style={{ width: `${confidencePct}%` }} />
      </div>
      <div className="mt-3 text-xs text-muted">
        Same product: {auditResult.isSameProduct ?? '—'} • Usable:{' '}
        {String(auditResult.usableForEnrichment ?? '—')}
      </div>
      <div className="mt-3 text-sm">{auditResult.reasoning}</div>
      {auditResult.criticalDiscrepancies?.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted">
          {auditResult.criticalDiscrepancies.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {auditResult.auditedAt ? (
        <div className="mt-2 text-xs text-muted">Audited: {auditResult.auditedAt}</div>
      ) : null}
    </div>
  );
}
