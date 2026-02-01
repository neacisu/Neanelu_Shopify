import type { ProductSearchResult } from '@app/types';

type VectorResultProps = Readonly<{
  result: ProductSearchResult;
  onClick: () => void;
  showScore?: boolean;
}>;

function scoreClass(score: number) {
  if (score >= 0.9) return 'bg-emerald-500 text-white';
  if (score >= 0.7) return 'bg-amber-400 text-black';
  return 'bg-red-500 text-white';
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

export function VectorResultCard({ result, onClick, showScore = true }: VectorResultProps) {
  const priceLabel = formatPriceRange(result);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col overflow-hidden rounded-lg border bg-background text-left shadow-sm transition hover:border-muted/60 hover:shadow"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted/10">
        {result.featuredImageUrl ? (
          <img
            src={result.featuredImageUrl}
            alt={result.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted">
            No image
          </div>
        )}
        {showScore ? (
          <span
            className={`absolute right-3 top-3 rounded-full px-2 py-1 text-[11px] font-semibold ${scoreClass(
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
        {priceLabel ? <div className="text-sm text-foreground">{priceLabel}</div> : null}
      </div>
    </button>
  );
}
