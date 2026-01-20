import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router-dom';
import {
  data,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useRevalidator,
} from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { Tabs } from '../components/ui/tabs';
import { ScheduleForm, ConfirmDialog } from '../components/domain/index.js';
import { PolarisCard } from '../../components/polaris/index.js';
import { apiAction, type ActionData, createActionApiClient } from '../utils/actions';
import { apiLoader, createLoaderApiClient, type LoaderData } from '../utils/loaders';

export type BulkSchedule = Readonly<{
  id: string;
  cron: string;
  timezone: string;
  enabled: boolean;
}>;

type ScheduleActionIntent = 'schedule.create' | 'schedule.update' | 'schedule.delete';

type ScheduleActionResult =
  | {
      ok: true;
      intent: ScheduleActionIntent;
      toast?: { type: 'success' | 'error'; message: string };
    }
  | { ok: false; error: { code: string; message: string } };

export const loader = apiLoader(async (_args: LoaderFunctionArgs) => {
  const api = createLoaderApiClient();
  const schedules = await api.getApi<{ schedules: BulkSchedule[] }>('/bulk/schedules');
  return schedules;
});

export const action = apiAction(async (args: ActionFunctionArgs) => {
  const api = createActionApiClient();
  const formData = await args.request.formData();
  const intent = formData.get('intent');

  if (
    intent !== 'schedule.create' &&
    intent !== 'schedule.update' &&
    intent !== 'schedule.delete'
  ) {
    return data(
      { ok: false, error: { code: 'missing_intent', message: 'Missing intent' } },
      { status: 400 }
    );
  }

  if (intent === 'schedule.delete') {
    const id = formData.get('id');
    if (!id || typeof id !== 'string') {
      return data(
        { ok: false, error: { code: 'missing_id', message: 'Missing schedule id' } },
        { status: 400 }
      );
    }
    await api.getApi(`/bulk/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return data({
      ok: true,
      intent,
      toast: { type: 'success', message: 'Schedule deleted' },
    } satisfies ScheduleActionResult);
  }

  const cron = formData.get('cron');
  const timezone = formData.get('timezone');
  const enabled = formData.get('enabled');

  if (typeof cron !== 'string' || typeof timezone !== 'string') {
    return data(
      { ok: false, error: { code: 'missing_fields', message: 'Missing schedule fields' } },
      { status: 400 }
    );
  }

  const payload = {
    cron,
    timezone,
    enabled: enabled === 'true',
  };

  if (intent === 'schedule.create') {
    await api.postApi('/bulk/schedules', payload);
    return data({
      ok: true,
      intent,
      toast: { type: 'success', message: 'Schedule created' },
    } satisfies ScheduleActionResult);
  }

  const id = formData.get('id');
  if (!id || typeof id !== 'string') {
    return data(
      { ok: false, error: { code: 'missing_id', message: 'Missing schedule id' } },
      { status: 400 }
    );
  }

  await api.postApi(`/bulk/schedules/${encodeURIComponent(id)}`, payload, { method: 'PUT' });

  return data({
    ok: true,
    intent,
    toast: { type: 'success', message: 'Schedule updated' },
  } satisfies ScheduleActionResult);
});

type RouteLoaderData = LoaderData<typeof loader>;
type RouteActionData = ActionData<typeof action>;

export default function IngestionSchedulePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { schedules } = useLoaderData<RouteLoaderData>();
  const actionFetcher = useFetcher<RouteActionData>();
  const [activeSchedule, setActiveSchedule] = useState<BulkSchedule | null>(schedules[0] ?? null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    const result = actionFetcher.data;
    if (!result) return;
    if (result.ok) {
      if ('toast' in result && result.toast?.type === 'success') {
        toast.success(result.toast.message);
      }
      void revalidator.revalidate();
    } else {
      toast.error(result.error.message);
    }
  }, [actionFetcher.data, revalidator]);

  useEffect(() => {
    setActiveSchedule(schedules[0] ?? null);
  }, [schedules]);

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Ingestion', href: '/ingestion' },
      { label: 'Schedule', href: location.pathname },
    ],
    [location.pathname]
  );

  const tabs = [
    { label: 'Overview', value: 'overview', to: '/ingestion' },
    { label: 'History', value: 'history', to: '/ingestion/history' },
    { label: 'Schedule', value: 'schedule', to: '/ingestion/schedule' },
  ];

  const submitSchedule = (schedule: {
    id?: string;
    cron: string;
    timezone: string;
    enabled: boolean;
  }) => {
    const formData = new FormData();
    if (schedule.id) {
      formData.set('intent', 'schedule.update');
      formData.set('id', schedule.id);
    } else {
      formData.set('intent', 'schedule.create');
    }
    formData.set('cron', schedule.cron);
    formData.set('timezone', schedule.timezone);
    formData.set('enabled', String(schedule.enabled));
    void actionFetcher.submit(formData, { method: 'post' });
  };

  const deleteSchedule = (id: string) => {
    const formData = new FormData();
    formData.set('intent', 'schedule.delete');
    formData.set('id', id);
    void actionFetcher.submit(formData, { method: 'post' });
  };

  return (
    <div className="space-y-4">
      <Breadcrumbs items={breadcrumbs} />

      <div className="flex flex-wrap items-center gap-4">
        <Tabs
          items={tabs.map((tab) => ({ label: tab.label, value: tab.value }))}
          value="schedule"
          onValueChange={(v) => {
            const target = tabs.find((t) => t.value === v)?.to ?? '/ingestion';
            void navigate(target);
          }}
        />
      </div>

      <PolarisCard className="p-4">
        <ScheduleForm
          schedule={activeSchedule ?? null}
          onSubmit={submitSchedule}
          saving={actionFetcher.state !== 'idle'}
        />
        {activeSchedule?.id ? (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="text-sm text-red-600 hover:underline"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              Delete schedule
            </button>
          </div>
        ) : null}
      </PolarisCard>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete schedule?"
        message="This will remove the current schedule."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmTone="critical"
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          if (!activeSchedule?.id) return;
          setConfirmDeleteOpen(false);
          deleteSchedule(activeSchedule.id);
        }}
        confirmDisabled={actionFetcher.state !== 'idle'}
        confirmLoading={actionFetcher.state !== 'idle'}
        cancelDisabled={actionFetcher.state !== 'idle'}
      />
    </div>
  );
}
