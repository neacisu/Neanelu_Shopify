import type { ProductSearchResult } from '@app/types';
import { useReducedMotion } from '../../hooks/use-reduced-motion';

type VectorResultProps = Readonly<{
  result: ProductSearchResult;
  onClick: () => void;
  showScore?: boolean;
  index?: number;
}>;

function scoreClass(score: number) {
  if (score >= 0.9) return 'bg-success text-success-foreground';
  if (score >= 0.7) return 'bg-warning text-warning-foreground';
  return 'bg-error/50 text-error-foreground';
}

function formatPriceRange(result: ProductSearchResult): string | null {
  const range = result.priceRange;
  if (!range) return null;
  const min = Number(range.min);
  const max = Number(range.max);
  const currency = range.currency || 'RON';
  const formatter = new Intl.NumberFormat('ro-RO', { style: 'currency', currency });
  if (Number.isFinite(min) && Number.isFinite(max)) {
    if (min === max) return formatter.format(min);
    return `${formatter.format(min)} – ${formatter.format(max)}`;
  }
  return null;
}

export function VectorResultCard({
  result,
  onClick,
  showScore = true,
  index = 0,
}: VectorResultProps) {
  const reducedMotion = useReducedMotion();
  const priceLabel = formatPriceRange(result);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm text-left shadow-[var(--shadow-sm)] transition-all duration-200 hover:border-border hover:shadow-[var(--shadow-md)] hover:bg-card/90 focus-ring-standard"
      style={
        reducedMotion ? undefined : { animation: `fadeSlideUp 0.35s ease-out ${index * 60}ms both` }
      }
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-subtle">
        {result.featuredImageUrl ? (
          <img
            src={result.featuredImageUrl}
            alt={result.title}
            className="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted">
            Fără imagine
          </div>
        )}
        {showScore ? (
          <span
            className={`absolute right-3 top-3 rounded-lg px-2 py-1 text-[11px] font-semibold shadow-[var(--shadow-sm)] ${scoreClass(
              result.similarity
            )}`}
          >
            {result.similarity.toFixed(2)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="text-sm font-semibold text-foreground line-clamp-2">{result.title}</div>
        {result.vendor ? <div className="text-xs text-muted">{result.vendor}</div> : null}
        {priceLabel ? (
          <div className="text-sm font-medium text-foreground">{priceLabel}</div>
        ) : null}
      </div>
    </button>
  );
}
