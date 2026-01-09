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
  value: unknown;
  title?: ReactNode;

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
}>;

export function JsonViewer(props: JsonViewerProps) {
  const {
    value,
    title,
    collapseThresholdChars = 120_000,
    collapsedDepth = 2,
    maxStringifyChars = 200_000,
    maxHeight = 360,
    className,
    copyable = true,
  } = props;

  const { rawText, truncated } = useMemo(() => {
    const { text } = safeStringify(value, 2);
    if (text.length <= maxStringifyChars) return { rawText: text, truncated: false };
    return {
      rawText: `${text.slice(0, maxStringifyChars)}\n…(truncated)…`,
      truncated: true,
    };
  }, [value, maxStringifyChars]);

  const isLarge = rawText.length > collapseThresholdChars;
  const [expanded, setExpanded] = useState<boolean>(() => !isLarge);

  const viewValue = useMemo(() => toJsonViewValue(value), [value]);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
    } catch {
      // ignore
    }
  };

  const showToolbar = Boolean(title) || copyable || isLarge;

  return (
    <div className={className}>
      {showToolbar ? (
        <div className="flex items-center justify-between gap-2">
          {title ? <div className="text-h4">{title}</div> : <div />}
          <div className="flex items-center gap-2">
            {isLarge ? (
              <Button
                variant="ghost"
                type="button"
                onClick={() => setExpanded((v) => !v)}
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
      ) : null}

      <div
        className={`${showToolbar ? 'mt-2' : ''} overflow-auto rounded-md border bg-muted/10 p-3 text-xs`}
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
