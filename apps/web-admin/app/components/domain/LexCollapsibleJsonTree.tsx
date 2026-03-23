import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { Button } from '../ui/button';

const LARGE_JSON_BYTES = 10 * 1024;
const STRING_PREVIEW_CHARS = 280;

function stringifyPretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[Unable to serialize JSON — possible circular structure]';
  }
}

function stringifyCompact(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function formatJsonLeaf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value);
  } catch {
    return '[Unserializable]';
  }
}

function JsonScalar({ value }: Readonly<{ value: unknown }>) {
  if (value === null) {
    return <span className="text-muted">null</span>;
  }
  const t = typeof value;
  if (t === 'boolean') {
    return <span className="text-foreground">{value ? 'true' : 'false'}</span>;
  }
  if (t === 'number') {
    return <span className="text-foreground">{Number(value).toString()}</span>;
  }
  if (t === 'string') {
    const s = value as string;
    if (s.length > STRING_PREVIEW_CHARS) {
      return (
        <span className="break-all text-emerald-800 dark:text-emerald-300">
          &quot;{s.slice(0, STRING_PREVIEW_CHARS)}…&quot;{' '}
          <span className="text-muted">({s.length} chars)</span>
        </span>
      );
    }
    return (
      <span className="break-all text-emerald-800 dark:text-emerald-300">&quot;{s}&quot;</span>
    );
  }
  return <span className="text-muted">{formatJsonLeaf(value)}</span>;
}

function JsonCollapsibleNode({
  label,
  children,
  defaultOpen = false,
  ariaLabel,
}: Readonly<{
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  ariaLabel: string;
}>) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="min-w-0">
      <button
        type="button"
        className="flex max-w-full items-baseline gap-1 rounded px-0.5 text-left font-mono text-xs text-foreground hover:bg-muted/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="shrink-0 text-muted">{open ? '▼' : '▶'}</span>
        <span className="break-all">{label}</span>
      </button>
      {open ? <div className="ml-3 border-l border-border pl-2">{children}</div> : null}
    </div>
  );
}

function JsonTreeValue({ value, path }: Readonly<{ value: unknown; path: string }>) {
  if (value === null || typeof value !== 'object') {
    return <JsonScalar value={value} />;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="font-mono text-xs text-muted">[]</span>;
    }
    return (
      <JsonCollapsibleNode label={`Array(${value.length})`} ariaLabel={`Expand array at ${path}`}>
        <ul className="list-none space-y-1 p-0">
          {value.map((item: unknown, i: number) => (
            <li key={`${path}#${String(i)}`} className="font-mono text-xs">
              <span className="text-muted">{i}: </span>
              <JsonTreeValue value={item} path={`${path}[${i}]`} />
            </li>
          ))}
        </ul>
      </JsonCollapsibleNode>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return <span className="font-mono text-xs text-muted">{'{}'}</span>;
  }

  return (
    <JsonCollapsibleNode
      label={`{${entries.length} ${entries.length === 1 ? 'key' : 'keys'}}`}
      ariaLabel={`Expand object at ${path}`}
    >
      <ul className="list-none space-y-1 p-0">
        {entries.map(([k, v]) => (
          <li key={k} className="font-mono text-xs">
            <span className="text-sky-800 dark:text-sky-300">&quot;{k}&quot;</span>
            <span className="text-muted">: </span>
            <JsonTreeValue value={v} path={`${path}.${k}`} />
          </li>
        ))}
      </ul>
    </JsonCollapsibleNode>
  );
}

export type LexCollapsibleJsonTreeProps = Readonly<{
  /** JSON-serializable value (object, array, primitive). */
  value: unknown;
  /** Optional heading shown above the toolbar. */
  title?: string;
  /** Class on outer wrapper. */
  className?: string;
}>;

/**
 * Collapsible JSON tree for read-only payloads (evidence, snapshots, API payloads).
 * Large values (&gt;10KB serialized) stay gated until the user expands the tree.
 */
export function LexCollapsibleJsonTree({ value, title, className }: LexCollapsibleJsonTreeProps) {
  const [largeUnlocked, setLargeUnlocked] = useState(false);
  const [copied, setCopied] = useState(false);

  const compactLen = useMemo(() => stringifyCompact(value).length, [value]);
  const isLarge = compactLen > LARGE_JSON_BYTES;

  const handleCopy = useCallback(async () => {
    const text = stringifyPretty(value);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [value]);

  return (
    <div className={`rounded-lg border border-border bg-card p-3 ${className ?? ''}`.trim()}>
      <div
        className={`mb-2 flex flex-wrap items-center gap-2 ${title ? 'justify-between' : 'justify-end'}`}
      >
        {title ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</span>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0"
          onClick={() => void handleCopy()}
          aria-label="Copy JSON to clipboard"
        >
          {copied ? 'Copied' : 'Copy JSON'}
        </Button>
      </div>

      {isLarge && !largeUnlocked ? (
        <div className="rounded-md bg-muted/50 p-3 text-sm text-muted">
          <p>
            Large payload (~{Math.max(1, Math.round(compactLen / 1024))} KB). The tree is not
            rendered until you expand — avoids blocking the UI.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-2"
            variant="primary"
            onClick={() => setLargeUnlocked(true)}
          >
            Expand tree
          </Button>
        </div>
      ) : (
        <div className="max-h-[min(70vh,32rem)] overflow-auto rounded-md bg-subtle/40 p-2">
          <JsonTreeValue value={value} path="$" />
        </div>
      )}
    </div>
  );
}
