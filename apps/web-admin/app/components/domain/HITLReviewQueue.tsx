import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';

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
      const key = event.key.toLowerCase();
      if (['1', '2', '3', '4', '5'].includes(key)) {
        const nextIndex = Number(key) - 1;
        if (!Number.isNaN(nextIndex) && nextIndex < matches.length) {
          setIndex(nextIndex);
        }
      }
      if (key === 'u') {
        setIndex((prev) => Math.max(prev - 1, 0));
      }
      if (key === 'd') {
        window.open(current.source_url, '_blank', 'noopener,noreferrer');
      }
      if (key === 'c') {
        onReview(current.id, 'confirm', notes.trim() || undefined);
        setNotes('');
        setIndex((prev) => Math.min(prev + 1, matches.length - 1));
      }
      if (key === 'r') {
        onReview(current.id, 'reject', notes.trim() || undefined);
        setNotes('');
        setIndex((prev) => Math.min(prev + 1, matches.length - 1));
      }
      if (key === 's') {
        onSkip(current.id);
        setNotes('');
        setIndex((prev) => Math.min(prev + 1, matches.length - 1));
      }
      if (key === 'n') {
        notesRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current, matches.length, notes, onReview, onSkip]);

  if (!current) {
    return (
      <div className="rounded-lg border border-muted/20 dark:border-slate-700 bg-muted/5 dark:bg-slate-800/50 p-4 text-sm text-muted dark:text-slate-400">
        Nu există items pentru HITL review.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-muted/20 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-body dark:text-slate-100">
          Coada review HITL
          <InfoTooltip title="HITL Review">
            Human-In-The-Loop: procesează potrivirile rapid cu scurtături de tastatură. C confirmă
            sursa, R respinge, S omite pentru mai târziu. D deschide sursa externă.
          </InfoTooltip>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onSkip(current.id)}>
          Omite
        </Button>
      </div>
      <div className="mt-2 text-xs text-muted dark:text-slate-400">
        Progress: {index + 1} / {matches.length} ({progress}%)
      </div>
      <div className="mt-1 text-[11px] text-muted dark:text-slate-500">
        Scurtături: 1-5 selectează • C confirmă • R respinge • S omite • U undo • D detalii • N note
      </div>
      <div className="mt-3 text-sm text-muted dark:text-slate-300">
        {current.source_title ?? current.source_url}
      </div>
      <div className="mt-3 text-xs text-muted dark:text-slate-400">
        Similarity: {Number(current.similarity_score).toFixed(2)} • Method:{' '}
        {current.match_method ?? '-'}
      </div>
      <div className="mt-3">
        <label className="text-xs text-muted dark:text-slate-400">Note (opțional)</label>
        <textarea
          ref={notesRef}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="mt-1 w-full rounded-md border border-muted/20 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-200 transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
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
          Confirmă (C)
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
          Respinge (R)
        </Button>
      </div>
    </div>
  );
}
