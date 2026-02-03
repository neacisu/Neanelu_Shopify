import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/button';

interface HITLMatchItem {
  id: string;
  source_url: string;
  source_title: string | null;
  similarity_score: string;
  match_method?: string;
}

interface HITLReviewQueueProps {
  matches: HITLMatchItem[];
  onReview: (matchId: string, decision: 'confirm' | 'reject', notes?: string) => void;
  onSkip: (matchId: string) => void;
}

export function HITLReviewQueue({ matches, onReview, onSkip }: HITLReviewQueueProps) {
  const [index, setIndex] = useState(0);
  const [notes, setNotes] = useState('');
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const current = matches[index];
  const progress = useMemo(
    () => (matches.length === 0 ? 0 : Math.round(((index + 1) / matches.length) * 100)),
    [index, matches.length]
  );

  useEffect(() => {
    if (index >= matches.length) {
      setIndex(0);
    }
  }, [index, matches.length]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!current) return;
      if (event.key.toLowerCase() === 'c') {
        onReview(current.id, 'confirm', notes.trim() || undefined);
        setNotes('');
        setIndex((prev) => Math.min(prev + 1, matches.length - 1));
      }
      if (event.key.toLowerCase() === 'r') {
        onReview(current.id, 'reject', notes.trim() || undefined);
        setNotes('');
        setIndex((prev) => Math.min(prev + 1, matches.length - 1));
      }
      if (event.key.toLowerCase() === 's') {
        onSkip(current.id);
        setNotes('');
        setIndex((prev) => Math.min(prev + 1, matches.length - 1));
      }
      if (event.key.toLowerCase() === 'n') {
        notesRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current, matches.length, notes, onReview, onSkip]);

  if (!current) {
    return (
      <div className="rounded-lg border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
        Nu există items pentru HITL review.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="flex items-center justify-between">
        <div className="text-body">HITL Review Queue</div>
        <Button size="sm" variant="ghost" onClick={() => onSkip(current.id)}>
          Skip
        </Button>
      </div>
      <div className="mt-2 text-xs text-muted">
        Progress: {index + 1} / {matches.length} ({progress}%)
      </div>
      <div className="mt-3 text-sm text-muted">{current.source_title ?? current.source_url}</div>
      <div className="mt-3 text-xs text-muted">
        Similarity: {Number(current.similarity_score).toFixed(2)} • Method:{' '}
        {current.match_method ?? '-'}
      </div>
      <div className="mt-3">
        <label className="text-xs text-muted">Notes (optional)</label>
        <textarea
          ref={notesRef}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-sm"
          rows={3}
        />
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            onReview(current.id, 'confirm', notes.trim() || undefined);
            setNotes('');
            setIndex((prev) => Math.min(prev + 1, matches.length - 1));
          }}
        >
          Confirm (C)
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onReview(current.id, 'reject', notes.trim() || undefined);
            setNotes('');
            setIndex((prev) => Math.min(prev + 1, matches.length - 1));
          }}
        >
          Reject (R)
        </Button>
      </div>
    </div>
  );
}
