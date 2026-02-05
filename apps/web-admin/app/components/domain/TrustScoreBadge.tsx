type TrustScoreBadgeProps = Readonly<{
  score: number | null | undefined;
}>;

function getTone(score: number): string {
  if (score >= 0.9) return 'bg-emerald-100 text-emerald-700';
  if (score >= 0.7) return 'bg-green-100 text-green-700';
  if (score >= 0.5) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

export function TrustScoreBadge({ score }: TrustScoreBadgeProps) {
  if (score == null || Number.isNaN(score)) {
    return <span className="rounded-full bg-muted/20 px-2 py-1 text-xs font-medium">N/A</span>;
  }
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${getTone(score)}`}>
      {score.toFixed(2)}
    </span>
  );
}
