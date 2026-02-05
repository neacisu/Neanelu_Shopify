type ConflictIndicatorProps = Readonly<{
  count: number;
}>;

export function ConflictIndicator({ count }: ConflictIndicatorProps) {
  if (!count || count <= 0) return null;
  const tone =
    count >= 3 ? 'bg-red-100 text-red-700' : count >= 1 ? 'bg-amber-100 text-amber-700' : '';
  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{count}</span>;
}
