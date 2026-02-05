type VotingRow = Readonly<{
  sourceName: string;
  value: string;
  trustScore: number;
  similarityScore: number;
}>;

type MultiSourceVotingViewProps = Readonly<{
  attributeName: string;
  votes: VotingRow[];
  minVotes?: number;
}>;

function toWeight(vote: VotingRow): number {
  return vote.trustScore * vote.similarityScore;
}

export function MultiSourceVotingView({
  attributeName,
  votes,
  minVotes = 1,
}: MultiSourceVotingViewProps) {
  const grouped = new Map<string, { count: number; weight: number }>();
  for (const vote of votes) {
    const entry = grouped.get(vote.value) ?? { count: 0, weight: 0 };
    entry.count += 1;
    entry.weight += toWeight(vote);
    grouped.set(vote.value, entry);
  }
  const ranked = Array.from(grouped.entries()).sort((a, b) => b[1].weight - a[1].weight);
  const winner = ranked[0];

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">{attributeName}</div>
      <div className="overflow-hidden rounded-md border border-muted/20">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Source</th>
              <th className="px-3 py-2 text-left font-medium">Value</th>
              <th className="px-3 py-2 text-right font-medium">Trust</th>
              <th className="px-3 py-2 text-right font-medium">Similarity</th>
              <th className="px-3 py-2 text-right font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {votes.map((vote, idx) => (
              <tr key={`${vote.sourceName}-${idx}`} className="border-t border-muted/20">
                <td className="px-3 py-2">{vote.sourceName}</td>
                <td className="px-3 py-2">{vote.value}</td>
                <td className="px-3 py-2 text-right">{vote.trustScore.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{vote.similarityScore.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{toWeight(vote).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {winner ? (
        <div className="text-xs text-muted">
          Winner: {winner[0]} (votes: {winner[1].count}, weight: {winner[1].weight.toFixed(3)}). Min
          votes required: {minVotes}
        </div>
      ) : (
        <div className="text-xs text-muted">No winner.</div>
      )}
    </div>
  );
}
