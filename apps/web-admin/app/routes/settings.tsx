import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ActionFunctionArgs } from 'react-router-dom';
import { useActionData, useLocation, useNavigation, useSubmit } from 'react-router-dom';

import { SettingsSchema } from '@app/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import type { SettingsInput } from '@app/validation';
import type { AiSettingsResponse, AiSettingsUpdateRequest } from '@app/types';
import { useForm } from 'react-hook-form';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { FormErrorSummary } from '../components/forms/form-error-summary';
import { FormField } from '../components/forms/form-field';
import { SubmitButton } from '../components/forms/submit-button';
import { Tabs } from '../components/ui/tabs';
import { useApiClient } from '../hooks/use-api';

type ActionData =
  | {
      ok: true;
    }
  | {
      ok: false;
      errors: Record<string, string[]>;
    };

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const input = {
    email: getFormString(formData, 'email'),
    shopDomain: getFormString(formData, 'shopDomain'),
  };

  const parsed = SettingsSchema.safeParse(input);

  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const [firstPath] = issue.path;
      const key = firstPath ? String(firstPath) : 'form';
      const bucket = errors[key] ?? (errors[key] = []);
      bucket.push(issue.message);
    }

    return new Response(JSON.stringify({ ok: false, errors } satisfies ActionData), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true } satisfies ActionData), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export default function SettingsPage() {
  const actionData = useActionData<ActionData>();
  const location = useLocation();
  const api = useApiClient();

  const navigation = useNavigation();
  const submit = useSubmit();
  const [showSuccess, setShowSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  const [aiLoading, setAiLoading] = useState(true);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiSuccess, setAiSuccess] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiEmbeddingsModel, setAiEmbeddingsModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiApiKeyDirty, setAiApiKeyDirty] = useState(false);
  const [aiHasApiKey, setAiHasApiKey] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors: formErrors, submitCount },
  } = useForm<SettingsInput>({
    resolver: zodResolver(SettingsSchema),
    mode: 'onBlur',
  });

  useEffect(() => {
    if (actionData?.ok !== true) return;

    setShowSuccess(true);
    const timer = setTimeout(() => setShowSuccess(false), 2000);
    return () => clearTimeout(timer);
  }, [actionData?.ok]);

  useEffect(() => {
    let cancelled = false;

    const loadAiSettings = async () => {
      setAiLoading(true);
      setAiError(null);
      try {
        const data = await api.getApi<AiSettingsResponse>('/settings/ai');
        if (cancelled) return;
        setAiEnabled(data.enabled);
        setAiBaseUrl(data.openaiBaseUrl ?? '');
        setAiEmbeddingsModel(data.openaiEmbeddingsModel ?? '');
        setAiHasApiKey(data.hasApiKey);
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : 'Nu am putut încărca setările OpenAI.';
          setAiError(message);
        }
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    };

    void loadAiSettings();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!aiSuccess) return;
    const timer = setTimeout(() => setAiSuccess(false), 2000);
    return () => clearTimeout(timer);
  }, [aiSuccess]);

  useEffect(() => {
    if (actionData?.ok !== false) return;

    let firstFieldToFocus: keyof SettingsInput | null = null;
    for (const [field, msgs] of Object.entries(actionData.errors)) {
      const message = msgs?.[0];
      if (!message) continue;

      if (field === 'email' || field === 'shopDomain') {
        setError(field, { type: 'server', message });
        firstFieldToFocus ??= field;
      }
    }

    if (firstFieldToFocus) {
      setFocus(firstFieldToFocus, { shouldSelect: true });
    }
  }, [actionData, setError, setFocus]);

  const errors = useMemo(() => {
    const record: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(formErrors)) {
      const message = (value as { message?: unknown } | undefined)?.message;
      if (typeof message === 'string' && message.length > 0) {
        record[key] = [message];
      }
    }
    return Object.keys(record).length ? record : undefined;
  }, [formErrors]);

  const submitState = useMemo(() => {
    if (navigation.state === 'submitting' || navigation.state === 'loading') return 'loading';
    if (showSuccess) return 'success';
    if (submitCount > 0 && errors) return 'error';
    return 'idle';
  }, [errors, navigation.state, showSuccess, submitCount]);

  const onValid = (values: SettingsInput) => {
    const formData = new FormData();
    formData.set('email', values.email);
    formData.set('shopDomain', values.shopDomain);
    void submit(formData, { method: 'post' });
  };

  const onInvalid = () => {
    // Focus the first invalid field for better a11y/UX.
    if (formErrors.email) {
      setFocus('email', { shouldSelect: true });
      return;
    }
    if (formErrors.shopDomain) {
      setFocus('shopDomain', { shouldSelect: true });
    }
  };

  const aiSubmitState = useMemo(() => {
    if (aiSaving) return 'loading';
    if (aiSuccess) return 'success';
    if (aiError) return 'error';
    return 'idle';
  }, [aiError, aiSaving, aiSuccess]);

  const onSaveAiSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAiSaving(true);
    setAiSuccess(false);
    setAiError(null);

    const payload: AiSettingsUpdateRequest = {
      enabled: aiEnabled,
      openaiBaseUrl: aiBaseUrl.trim() ? aiBaseUrl.trim() : null,
      openaiEmbeddingsModel: aiEmbeddingsModel.trim() ? aiEmbeddingsModel.trim() : null,
    };

    if (aiApiKeyDirty) {
      payload.apiKey = aiApiKey;
    }

    try {
      const data = await api.getApi<AiSettingsResponse>('/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setAiEnabled(data.enabled);
      setAiBaseUrl(data.openaiBaseUrl ?? '');
      setAiEmbeddingsModel(data.openaiEmbeddingsModel ?? '');
      setAiHasApiKey(data.hasApiKey);
      setAiApiKey('');
      setAiApiKeyDirty(false);
      setAiSuccess(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Salvarea setărilor OpenAI a eșuat.';
      setAiError(message);
    } finally {
      setAiSaving(false);
    }
  };

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Settings', href: location.pathname },
    ],
    [location.pathname]
  );

  const tabs = useMemo(
    () => [
      { label: 'General', value: 'general' },
      { label: 'OpenAI', value: 'openai' },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />

      <PageHeader title="Settings" description="Demo form for PR-018 validation patterns." />

      <Tabs items={tabs} value={activeTab} onValueChange={setActiveTab} />

      {activeTab === 'general' ? (
        <>
          <FormErrorSummary errors={errors} title="Te rugăm să corectezi erorile" />

          <form
            onSubmit={(event) => void handleSubmit(onValid, onInvalid)(event)}
            className="space-y-4"
            noValidate
          >
            <FormField
              id="email"
              label="Email"
              type="email"
              registration={register('email')}
              error={formErrors.email?.message}
            />

            <FormField
              id="shopDomain"
              label="Shop Domain"
              placeholder="store.myshopify.com"
              registration={register('shopDomain')}
              error={formErrors.shopDomain?.message}
            />

            <SubmitButton state={submitState}>Save</SubmitButton>
          </form>

          {actionData?.ok === true ? (
            <div className="rounded-md border border-success/30 bg-success/10 p-4 text-success shadow-sm">
              Saved.
            </div>
          ) : null}
        </>
      ) : null}

      {activeTab === 'openai' ? (
        <form onSubmit={(event) => void onSaveAiSettings(event)} className="space-y-4" noValidate>
          {aiLoading ? (
            <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
              Se încarcă setările OpenAI...
            </div>
          ) : null}

          {aiError ? (
            <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm">
              {aiError}
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-body">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={aiEnabled}
              onChange={(event) => setAiEnabled(event.target.checked)}
            />
            Activează OpenAI pentru acest shop
          </label>

          <div>
            <label className="text-caption text-muted" htmlFor="openai-api-key">
              OpenAI API Key
            </label>
            <input
              id="openai-api-key"
              type="password"
              autoComplete="new-password"
              value={aiApiKey}
              placeholder={aiHasApiKey ? '••••••••••••' : 'Introdu cheia API'}
              onChange={(event) => {
                setAiApiKey(event.target.value);
                setAiApiKeyDirty(true);
              }}
              className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="mt-1 text-caption text-muted">
              Cheia este stocată criptat și nu poate fi afișată după salvare.
            </div>
            {aiHasApiKey ? (
              <button
                type="button"
                className="mt-2 text-caption text-primary hover:underline"
                onClick={() => {
                  setAiApiKey('');
                  setAiApiKeyDirty(true);
                }}
              >
                Șterge cheia salvată
              </button>
            ) : null}
            {aiApiKeyDirty && aiApiKey.trim().length === 0 && aiHasApiKey ? (
              <div className="mt-2 text-caption text-warning">
                Cheia va fi eliminată la salvare.
              </div>
            ) : null}
          </div>

          <div>
            <label className="text-caption text-muted" htmlFor="openai-embeddings-model">
              Model embeddings
            </label>
            <input
              id="openai-embeddings-model"
              type="text"
              value={aiEmbeddingsModel}
              onChange={(event) => setAiEmbeddingsModel(event.target.value)}
              className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="text-embedding-3-small"
            />
          </div>

          <div>
            <label className="text-caption text-muted" htmlFor="openai-base-url">
              OpenAI Base URL (opțional)
            </label>
            <input
              id="openai-base-url"
              type="text"
              value={aiBaseUrl}
              onChange={(event) => setAiBaseUrl(event.target.value)}
              className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="https://api.openai.com"
            />
          </div>

          <SubmitButton state={aiSubmitState}>Save OpenAI Settings</SubmitButton>

          {aiSuccess ? (
            <div className="rounded-md border border-success/30 bg-success/10 p-4 text-success shadow-sm">
              Setările OpenAI au fost salvate.
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
