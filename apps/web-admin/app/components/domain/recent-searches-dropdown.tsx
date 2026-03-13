import { formatDistanceToNow } from 'date-fns';
import { X } from 'lucide-react';
import { useReducedMotion } from '../../hooks/use-reduced-motion';

import { InfoTooltip } from '../ui/info-tooltip';

type RecentSearch = Readonly<{
  query: string;
  timestamp: number;
}>;

type RecentSearchesDropdownProps = Readonly<{
  searches: readonly RecentSearch[];
  onSelect: (query: string) => void;
  onClear: () => void;
  className?: string;
}>;

export function RecentSearchesDropdown({
  searches,
  onSelect,
  onClear,
  className,
}: RecentSearchesDropdownProps) {
  const reducedMotion = useReducedMotion();
  if (searches.length === 0) return null;

  return (
    <div
      className={
        'rounded-xl border border-border bg-card shadow-[var(--shadow-md)] ' + (className ?? '')
      }
      style={reducedMotion ? undefined : { animation: 'fadeSlideUp 0.25s ease-out both' }}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-medium text-muted">
        <span className="flex items-center gap-1.5">
          Căutări recente
          <InfoTooltip title="Căutări recente">
            Lista ultimelor interogări căutate. Apasă pe una pentru a o rula din nou instant.
          </InfoTooltip>
        </span>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs text-muted transition-all duration-200 hover:bg-subtle hover:text-foreground hover:scale-105"
          aria-label="Șterge căutările recente"
        >
          <X className="size-3" />
          Șterge
        </button>
      </div>
      <div className="max-h-56 overflow-auto">
        {searches.map((item) => (
          <button
            key={`${item.query}:${item.timestamp}`}
            type="button"
            onClick={() => onSelect(item.query)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-foreground transition-all duration-200 hover:bg-subtle hover:pl-4"
          >
            <span className="truncate">{item.query}</span>
            <span className="shrink-0 text-[11px] text-muted">
              {formatDistanceToNow(item.timestamp, { addSuffix: true })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
