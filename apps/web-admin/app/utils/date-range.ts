import { endOfDay, endOfMonth, startOfDay, startOfMonth, subDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { DateRange } from 'react-day-picker';

export type DateRangePreset = Readonly<{
  id: string;
  label: string;
  range: DateRange;
}>;

export type UtcIsoRange = Readonly<{
  fromUtcIso: string;
  toUtcIso: string;
}>;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toUtcIsoAtZonedBoundary(ymdDate: string, timeZone: string, boundary: 'start' | 'end') {
  const localIso = boundary === 'start' ? `${ymdDate}T00:00:00.000` : `${ymdDate}T23:59:59.999`;
  const utcDate = fromZonedTime(localIso, timeZone);
  return utcDate.toISOString();
}

export function toUtcIsoRange(range: DateRange, timeZone: string): UtcIsoRange | null {
  if (!range.from || !range.to) return null;
  const fromYmd = ymd(range.from);
  const toYmd = ymd(range.to);

  return {
    fromUtcIso: toUtcIsoAtZonedBoundary(fromYmd, timeZone, 'start'),
    toUtcIso: toUtcIsoAtZonedBoundary(toYmd, timeZone, 'end'),
  };
}

export function formatDateRangeLabel(
  range: DateRange | undefined,
  opts: { timeZone: string }
): string {
  if (!range?.from) return 'Select range';
  const tz = opts.timeZone;
  const from = formatInTimeZone(range.from, tz, 'MMM d, yyyy');
  if (!range.to) return `${from} – …`;
  const to = formatInTimeZone(range.to, tz, 'MMM d, yyyy');
  return `${from} – ${to}`;
}

export function getDateRangePresets(options: { now: Date; timeZone: string }): DateRangePreset[] {
  const { now, timeZone } = options;

  // Interpret "now" as a moment in time; derive date boundaries in the shop time zone.
  // We convert by formatting in TZ, then re-hydrating as a calendar date.
  const todayYmd = formatInTimeZone(now, timeZone, 'yyyy-MM-dd');
  const today = new Date(`${todayYmd}T12:00:00.000`); // noon avoids DST edge cases for Date math

  const last7From = subDays(today, 6);

  const thisMonthFrom = startOfMonth(today);
  const thisMonthTo = endOfMonth(today);

  const todayStart = startOfDay(today);
  const todayEnd = endOfDay(today);

  return [
    {
      id: 'today',
      label: 'Today',
      range: { from: todayStart, to: todayEnd },
    },
    {
      id: 'last7',
      label: 'Last 7 days',
      range: { from: startOfDay(last7From), to: todayEnd },
    },
    {
      id: 'thisMonth',
      label: 'This month',
      range: { from: startOfDay(thisMonthFrom), to: endOfDay(thisMonthTo) },
    },
  ];
}
