import type { DateRange } from 'react-day-picker';
import { useMemo, useState } from 'react';
import { addHours, format } from 'date-fns';
import cronParser from 'cron-parser';

import { Button } from '../ui/button';
import { DateRangePicker } from '../ui/DateRangePicker';
import { PolarisSelect, PolarisTextField } from '../../../components/polaris/index.js';

export type SchedulePreset = 'daily' | 'weekly' | 'custom';

export type BulkSchedule = Readonly<{
  id?: string;
  cron: string;
  timezone: string;
  enabled: boolean;
}>;

export type ScheduleFormProps = Readonly<{
  schedule?: BulkSchedule | null;
  onSubmit: (schedule: BulkSchedule) => void;
  onCancel?: () => void;
  saving?: boolean;
}>;

const TIMEZONES = [
  'UTC',
  'Europe/Bucharest',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
] as const;

function safePreview(cron: string, timezone: string, range?: DateRange): string[] {
  try {
    const interval = cronParser.parseExpression(cron, {
      tz: timezone,
      ...(range?.from ? { currentDate: range.from } : {}),
    });
    const next: string[] = [];
    for (let i = 0; i < 20 && next.length < 5; i += 1) {
      const date = interval.next().toDate();
      if (range?.to && date > range.to) break;
      next.push(format(date, 'yyyy-MM-dd HH:mm:ss'));
    }
    return next;
  } catch {
    return [];
  }
}

function isHourlyOrMore(cron: string, timezone: string): boolean {
  try {
    const interval = cronParser.parseExpression(cron, { tz: timezone });
    const first = interval.next().toDate();
    const second = interval.next().toDate();
    return second.getTime() - first.getTime() >= addHours(new Date(0), 1).getTime();
  } catch {
    return false;
  }
}

export function ScheduleForm({ schedule, onSubmit, onCancel, saving }: ScheduleFormProps) {
  const initialCron = schedule?.cron ?? '0 2 * * *';
  const initialTimezone = schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [preset, setPreset] = useState<SchedulePreset>('daily');
  const [dailyTime, setDailyTime] = useState('02:00');
  const [weeklyDay, setWeeklyDay] = useState('1');
  const [weeklyTime, setWeeklyTime] = useState('02:00');
  const [cron, setCron] = useState(initialCron);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [previewRange, setPreviewRange] = useState<DateRange | undefined>(undefined);

  const preview = useMemo(
    () => safePreview(cron, timezone, previewRange),
    [cron, previewRange, timezone]
  );

  const onPresetChange = (value: SchedulePreset) => {
    setPreset(value);
    if (value === 'daily') {
      const [hh, mm] = dailyTime.split(':');
      setCron(`${mm ?? '0'} ${hh ?? '2'} * * *`);
    }
    if (value === 'weekly') {
      const [hh, mm] = weeklyTime.split(':');
      setCron(`${mm ?? '0'} ${hh ?? '2'} * * ${weeklyDay}`);
    }
  };

  const updateDailyCron = (nextTime: string) => {
    setDailyTime(nextTime);
    const [hh, mm] = nextTime.split(':');
    setCron(`${mm ?? '0'} ${hh ?? '2'} * * *`);
  };

  const updateWeeklyCron = (nextDay: string, nextTime: string) => {
    setWeeklyDay(nextDay);
    setWeeklyTime(nextTime);
    const [hh, mm] = nextTime.split(':');
    setCron(`${mm ?? '0'} ${hh ?? '2'} * * ${nextDay}`);
  };

  const validate = () => {
    if (!preview.length) {
      setError('Invalid cron expression. Use five fields (min hour day month week).');
      return false;
    }
    if (!isHourlyOrMore(cron, timezone)) {
      setError('Schedule must run at least 1 hour apart.');
      return false;
    }
    setError(null);
    return true;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    onSubmit({
      ...(schedule?.id ? { id: schedule.id } : {}),
      cron,
      timezone,
      enabled,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <PolarisSelect
          label="Preset"
          value={preset}
          options={[
            { label: 'Daily', value: 'daily' },
            { label: 'Weekly', value: 'weekly' },
            { label: 'Custom', value: 'custom' },
          ]}
          onChange={(e) => onPresetChange((e.target as HTMLSelectElement).value as SchedulePreset)}
        />
        <PolarisSelect
          label="Timezone"
          value={timezone}
          options={TIMEZONES.map((tz) => ({ label: tz, value: tz }))}
          onChange={(e) => setTimezone((e.target as HTMLSelectElement).value)}
        />
      </div>

      {preset === 'daily' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-caption text-muted">Time (HH:MM)</label>
            <input
              type="time"
              value={dailyTime}
              onChange={(e) => updateDailyCron(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
            />
          </div>
        </div>
      ) : null}

      {preset === 'weekly' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <PolarisSelect
            label="Day of week"
            value={weeklyDay}
            options={[
              { label: 'Monday', value: '1' },
              { label: 'Tuesday', value: '2' },
              { label: 'Wednesday', value: '3' },
              { label: 'Thursday', value: '4' },
              { label: 'Friday', value: '5' },
              { label: 'Saturday', value: '6' },
              { label: 'Sunday', value: '0' },
            ]}
            onChange={(e) => updateWeeklyCron((e.target as HTMLSelectElement).value, weeklyTime)}
          />
          <div>
            <label className="text-caption text-muted">Time (HH:MM)</label>
            <input
              type="time"
              value={weeklyTime}
              onChange={(e) => updateWeeklyCron(weeklyDay, e.target.value)}
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
            />
          </div>
        </div>
      ) : null}

      <PolarisTextField
        label="Cron expression"
        value={cron}
        placeholder="0 2 * * *"
        onChange={(e) => setCron((e.target as HTMLInputElement).value)}
      />

      <div className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          id="schedule-enabled"
        />
        <label htmlFor="schedule-enabled">Enabled</label>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <div className="rounded-md border bg-muted/5 p-3 text-sm">
        <div className="text-caption text-muted">Next 5 runs</div>
        {preview.length ? (
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {preview.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 text-muted">No preview available.</div>
        )}
      </div>

      <DateRangePicker
        label="Preview window"
        value={previewRange}
        onChange={setPreviewRange}
        timeZone={timezone}
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
        <Button variant="secondary" onClick={handleSubmit} loading={saving ?? false}>
          Save schedule
        </Button>
      </div>
    </div>
  );
}
