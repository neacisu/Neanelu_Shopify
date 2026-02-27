import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';

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

  /** Plan prop: theme hint for the viewer container. 'auto' uses system/parent dark mode. */
  theme?: 'light' | 'dark' | 'auto';

  collapseThresholdChars?: number;
  collapsedDepth?: number;
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
    theme: themeProp = 'auto',
    searchable = true,
    searchPlaceholder = 'Caută…',
    maxSearchResults = 200,
  } = props;

  const value = valueProp !== undefined ? valueProp : data;

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => {
    if (themeProp === 'auto' && typeof window !== 'undefined') {
      if (document.documentElement.classList.contains('dark')) return 'dark';
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
      return 'light';
    }
    return themeProp === 'auto' ? 'light' : themeProp;
  });

  useEffect(() => {
    if (themeProp !== 'auto' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const check = () => {
      setResolvedTheme(
        document.documentElement.classList.contains('dark') || mq.matches ? 'dark' : 'light'
      );
    };
    check();
    mq.addEventListener('change', check);
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      mq.removeEventListener('change', check);
      obs.disconnect();
    };
  }, [themeProp]);

  const theme = themeProp === 'auto' ? resolvedTheme : themeProp;

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

  const [copied, setCopied] = useState(false);
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const showToolbar = Boolean(title) || copyable || isLarge;

  const toolbar = showToolbar ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {title ? (
        <div className="text-base font-semibold text-slate-800 dark:text-slate-200">{title}</div>
      ) : (
        <div />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {searchable ? (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-[var(--shadow-sm)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 focus:border-blue-500 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:shadow-[0_0_0_3px_rgba(96,165,250,0.2)]"
            placeholder={searchPlaceholder}
            aria-label="Caută"
          />
        ) : null}
        {isLarge ? (
          <Button
            variant="ghost"
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-pressed={expanded}
            className="text-slate-700 dark:text-slate-300"
          >
            {expanded ? 'Restrânge' : 'Extinde'}
          </Button>
        ) : null}
        {copyable ? (
          <Button
            variant="ghost"
            type="button"
            onClick={() => void copyText()}
            className="text-slate-700 dark:text-slate-300"
          >
            {copied ? (
              <span className="inline-flex items-center gap-1.5 motion-safe:animate-[fadeIn_150ms_ease-out]">
                <Check className="size-3.5 text-emerald-500" />
                Copiat!
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Copy className="size-3.5" />
                Copiază
              </span>
            )}
          </Button>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div className={className} data-theme={theme}>
      {toolbar}

      {searchable && search.trim() ? (
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/50">
          <div className="text-sm font-medium text-slate-600 dark:text-slate-400">
            Potriviri:{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {matches.length}
            </span>
            {matches.length >= maxSearchResults ? ' (limitat)' : ''}
          </div>
          {matches.length ? (
            <div className="mt-1.5 max-h-32 overflow-auto">
              {matches.map((m) => (
                <div key={`${m.path}:${m.preview}`} className="flex items-start gap-2 py-0.5">
                  <span className="shrink-0 font-mono text-[11px] text-slate-500 dark:text-slate-500">
                    {m.path}
                  </span>
                  <span className="truncate text-[11px] text-slate-700 dark:text-slate-400">
                    {m.preview}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-slate-500 dark:text-slate-500">Nicio potrivire.</div>
          )}
        </div>
      ) : null}

      <div
        className={`${showToolbar ? 'mt-2' : ''} overflow-auto rounded-xl border p-3 text-xs transition-colors duration-200 ${
          theme === 'dark'
            ? 'border-white/10 bg-zinc-950 text-zinc-50'
            : 'border-slate-200 bg-slate-50/50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
        }`}
        style={{ maxHeight }}
      >
        <JsonView
          data={viewValue}
          shouldExpandNode={(level) => (expanded ? true : level < collapsedDepth)}
          clickToExpandNode
        />
      </div>

      {isLarge ? (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-500">
          {truncated ? 'Truncat · ' : ''}Payload mare ({rawText.length.toLocaleString('ro-RO')}{' '}
          caractere) — afișare restrânsă implicit.
        </div>
      ) : null}
    </div>
  );
}
