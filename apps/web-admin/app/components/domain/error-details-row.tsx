import { Copy, ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';
import { JsonViewer } from '../ui/JsonViewer';

export type IngestionErrorRow = Readonly<{
  id: string;
  errorType?: string | null;
  errorCode?: string | null;
  errorMessage: string;
  lineNumber?: number | null;
  payload?: Record<string, unknown> | null;
  stackTrace?: string | null;
  suggestedFix?: string | null;
}>;

export type ErrorDetailsRowProps = Readonly<{
  error: IngestionErrorRow;
  expanded: boolean;
  onToggle: () => void;
}>;

export function ErrorDetailsRow({ error, expanded, onToggle }: ErrorDetailsRowProps) {
  const copy = async () => {
    const value = {
      id: error.id,
      errorType: error.errorType,
      errorCode: error.errorCode,
      errorMessage: error.errorMessage,
      lineNumber: error.lineNumber,
      suggestedFix: error.suggestedFix,
      payload: error.payload,
      stackTrace: error.stackTrace,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    } catch {
      // ignore
    }
  };

  return (
    <div className="rounded-md border bg-muted/5 p-3 dark:border-slate-700/60 dark:bg-slate-800/50">
      <button type="button" className="flex w-full items-center justify-between" onClick={onToggle}>
        <div className="text-sm font-medium dark:text-slate-200">{error.errorMessage}</div>
        {expanded ? (
          <ChevronUp className="size-4 dark:text-slate-400" />
        ) : (
          <ChevronDown className="size-4 dark:text-slate-400" />
        )}
      </button>

      {expanded ? (
        <div className="mt-3 space-y-3 text-sm motion-safe:animate-[fadeIn_0.2s_ease-out]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-caption text-muted">
              {error.errorType ? `${error.errorType}` : 'Eroare'}
              {error.errorCode ? ` · ${error.errorCode}` : ''}
              {typeof error.lineNumber === 'number' ? ` · linia ${error.lineNumber}` : ''}
            </div>
            <span className="inline-flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => void copy()}>
                <Copy className="size-4" />
                Copiază
              </Button>
              <InfoTooltip title="Copiază detaliile erorii" side="bottom" maxWidth={320}>
                Copiază mesajul, tipul, payload-ul și stack trace-ul în clipboard pentru debugging.
                Poți trimite echipei sau lipi în un tool de analiză.
              </InfoTooltip>
            </span>
          </div>

          {error.suggestedFix ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-300">
              Sugestie remediere: {error.suggestedFix}
            </div>
          ) : null}

          {error.payload ? (
            <JsonViewer value={error.payload} title="Payload (date care au eșuat)" theme="dark" />
          ) : null}

          {error.stackTrace ? (
            <div className="rounded-md border bg-gray-950 p-3 font-mono text-xs text-gray-100">
              <div className="text-caption text-gray-400">Stack trace</div>
              <pre className="mt-2 whitespace-pre-wrap wrap-break-word">{error.stackTrace}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
