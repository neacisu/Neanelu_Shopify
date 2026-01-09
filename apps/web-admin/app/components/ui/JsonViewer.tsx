import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import { JsonView } from 'react-json-view-lite';

import { Button } from './button';

type JsonViewValue = Record<string, unknown> | readonly unknown[];

function toJsonViewValue(value: unknown): JsonViewValue {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return { value };
}

function safeStringify(value: unknown, space: number): { text: string; ok: boolean } {
  try {
    return { text: JSON.stringify(value, null, space), ok: true };
  } catch {
    return { text: String(value), ok: false };
  }
}

export type JsonViewerProps = Readonly<{
  /** Preferred prop name (used in codebase). */
  value?: unknown;

  /** Plan alias. */
  data?: unknown;

  title?: ReactNode;

  /** Plan prop: controlled collapsed state (collapsed=true => collapsed). */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;

  /** Plan prop: theme hint for the viewer container. */
  theme?: 'light' | 'dark';

  /**
   * If JSON stringify exceeds this size, the viewer defaults to "collapsed" rendering.
   * This avoids DOM-heavy rendering for large payloads.
   */
  collapseThresholdChars?: number;

  /** Collapsed depth when collapsed mode is active. */
  collapsedDepth?: number;

  /**
   * If the stringified JSON exceeds this limit, it is truncated for rendering/copy.
   * This prevents giant payloads from freezing the UI.
   */
  maxStringifyChars?: number;

  maxHeight?: number | string;
  className?: string;

  /** Whether to show a copy button. */
  copyable?: boolean;

  /** Feature: search within JSON (shows matched paths/values). */
  searchable?: boolean;
  searchPlaceholder?: string;
  maxSearchResults?: number;
}>;

type JsonMatch = Readonly<{ path: string; preview: string }>;

function toPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  if (!parent) return key;
  return `${parent}.${key}`;
}

function searchJson(value: unknown, query: string, max: number): JsonMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const out: JsonMatch[] = [];
  const seen = new Set<unknown>();

  const visit = (v: unknown, path: string) => {
    if (out.length >= max) return;
    if (v && typeof v === 'object') {
      if (seen.has(v)) return;
      seen.add(v);
    }

    if (Array.isArray(v)) {
      v.forEach((child, i) => visit(child, toPath(path, i)));
      return;
    }

    if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (out.length >= max) break;
        const nextPath = toPath(path, k);

        if (String(k).toLowerCase().includes(q)) {
          out.push({ path: nextPath, preview: '(key match)' });
          if (out.length >= max) break;
        }

        visit(child, nextPath);
      }
      return;
    }

    const text = String(v);
    if (text.toLowerCase().includes(q)) {
      const preview = text.length > 180 ? `${text.slice(0, 180)}…` : text;
      out.push({ path: path || '(root)', preview });
    }
  };

  visit(value, '');
  return out;
}

export function JsonViewer(props: JsonViewerProps) {
  const {
    value: valueProp,
    data,
    title,
    collapseThresholdChars = 120_000,
    collapsedDepth = 2,
    maxStringifyChars = 200_000,
    maxHeight = 360,
    className,
    copyable = true,
    collapsed,
    onCollapsedChange,
    theme = 'light',
    searchable = true,
    searchPlaceholder = 'Search…',
    maxSearchResults = 200,
  } = props;

  const value = valueProp !== undefined ? valueProp : data;

  const { rawText, truncated } = useMemo(() => {
    const { text } = safeStringify(value, 2);
    if (text.length <= maxStringifyChars) return { rawText: text, truncated: false };
    return {
      rawText: `${text.slice(0, maxStringifyChars)}\n…(truncated)…`,
      truncated: true,
    };
  }, [value, maxStringifyChars]);

  const isLarge = rawText.length > collapseThresholdChars;
  const [expandedInternal, setExpandedInternal] = useState<boolean>(() => {
    if (collapsed !== undefined) return !collapsed;
    return !isLarge;
  });

  const expanded = collapsed !== undefined ? !collapsed : expandedInternal;
  const setExpanded = (next: boolean) => {
    if (collapsed !== undefined) {
      onCollapsedChange?.(!next);
      return;
    }
    setExpandedInternal(next);
    onCollapsedChange?.(!next);
  };

  const viewValue = useMemo(() => toJsonViewValue(value), [value]);

  const [search, setSearch] = useState<string>('');
  const matches = useMemo(() => {
    if (!searchable) return [];
    return searchJson(value, search, maxSearchResults);
  }, [maxSearchResults, search, searchable, value]);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
    } catch {
      // ignore
    }
  };

  const showToolbar = Boolean(title) || copyable || isLarge;

  const toolbar = showToolbar ? (
    <div className="flex items-center justify-between gap-2">
      {title ? <div className="text-h4">{title}</div> : <div />}
      <div className="flex items-center gap-2">
        {searchable ? (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-48 rounded-md border bg-background px-2 text-sm"
            placeholder={searchPlaceholder}
            aria-label="Search"
          />
        ) : null}
        {isLarge ? (
          <Button
            variant="ghost"
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-pressed={expanded}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </Button>
        ) : null}
        {copyable ? (
          <Button variant="ghost" type="button" onClick={() => void copyText()}>
            Copy
          </Button>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div className={className} data-theme={theme}>
      {toolbar}

      {searchable && search.trim() ? (
        <div className="mt-2 rounded-md border bg-muted/5 p-2 text-xs">
          <div className="text-sm">
            Matches: <span className="font-medium">{matches.length}</span>
            {matches.length >= maxSearchResults ? ' (limited)' : ''}
          </div>
          {matches.length ? (
            <div className="mt-1 max-h-32 overflow-auto">
              {matches.map((m) => (
                <div key={`${m.path}:${m.preview}`} className="flex items-start gap-2 py-0.5">
                  <span className="shrink-0 font-mono text-[11px] text-muted">{m.path}</span>
                  <span className="truncate text-[11px]">{m.preview}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-muted">No matches.</div>
          )}
        </div>
      ) : null}

      <div
        className={`${showToolbar ? 'mt-2' : ''} overflow-auto rounded-md border p-3 text-xs ${
          theme === 'dark' ? 'bg-zinc-950 text-zinc-50 border-white/10' : 'bg-muted/10'
        }`}
        style={{ maxHeight }}
      >
        {/*
          We avoid importing library CSS here; we rely on the default markup
          and tailwind container styles above.
        */}
        <JsonView
          data={viewValue}
          shouldExpandNode={(level) => (expanded ? true : level < collapsedDepth)}
          clickToExpandNode
        />
      </div>

      {isLarge ? (
        <div className="mt-1 text-caption text-muted">
          {truncated ? 'truncated · ' : ''}Large payload ({rawText.length.toLocaleString()} chars) —
          rendering is collapsed by default.
        </div>
      ) : null}
    </div>
  );
}
