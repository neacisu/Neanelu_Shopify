import { Clock3 } from 'lucide-react';

export interface DataFreshnessIndicatorProps {
  refreshedAt: string | null;
  label?: string;
}

function formatRelativeAge(refreshedAt: string | null): {
  text: string;
  toneClass: string;
} {
  if (!refreshedAt) {
    return {
      text: 'Niciodată actualizat',
      toneClass: 'text-muted',
    };
  }

  const refreshedTime = new Date(refreshedAt).getTime();
  if (Number.isNaN(refreshedTime)) {
    return {
      text: 'Timp necunoscut',
      toneClass: 'text-muted',
    };
  }

  const ageMs = Math.max(0, Date.now() - refreshedTime);
  const ageMinutes = Math.floor(ageMs / 60_000);
  const ageHours = Math.floor(ageMinutes / 60);

  if (ageMinutes < 60) {
    return {
      text: `acum ${ageMinutes} min`,
      toneClass: 'text-emerald-600 dark:text-emerald-400',
    };
  }
  if (ageHours < 3) {
    return {
      text: `acum ${ageHours} h`,
      toneClass: 'text-amber-600 dark:text-amber-400',
    };
  }
  return {
    text: `acum ${ageHours} h`,
    toneClass: 'text-red-600 dark:text-red-400',
  };
}

export function DataFreshnessIndicator({
  refreshedAt,
  label = 'Data',
}: DataFreshnessIndicatorProps) {
  const age = formatRelativeAge(refreshedAt);

  return (
    <div
      className="inline-flex items-center gap-2 rounded-md border border-muted/20 bg-background px-3 py-2 text-xs"
      aria-live="polite"
      role="status"
    >
      <Clock3 className="h-3.5 w-3.5 text-muted" />
      <span className="text-muted">{label} actualizat</span>
      <span className={age.toneClass}>{age.text}</span>
    </div>
  );
}
