import type { PropsWithChildren } from 'react';

export type PolarisTooltipProps = PropsWithChildren<{
  content?: string | React.ReactNode;
  /** @deprecated Use content. Kept for API compatibility. */
  title?: string;
  [key: string]: unknown;
}>;

/**
 * Simple tooltip wrapper. For rich content tooltips, use InfoTooltip from `~/components/ui/info-tooltip`.
 */
export function PolarisTooltip({ children, content, title, ...rest }: PolarisTooltipProps) {
  const tooltipText = content ?? title;
  const titleAttr =
    typeof tooltipText === 'string'
      ? tooltipText
      : typeof tooltipText === 'number' || typeof tooltipText === 'boolean'
        ? String(tooltipText)
        : undefined;

  if (!titleAttr) return <>{children}</>;

  return (
    <span title={titleAttr} className="inline-flex cursor-help" {...rest}>
      {children}
    </span>
  );
}
