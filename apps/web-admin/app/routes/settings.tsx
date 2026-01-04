import { useEffect, useMemo, useState } from 'react';
import type { ActionFunctionArgs } from 'react-router-dom';
import { useActionData, useLocation, useNavigation, useSubmit } from 'react-router-dom';

import { SettingsSchema } from '@app/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import type { SettingsInput } from '@app/validation';
import { useForm } from 'react-hook-form';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { FormErrorSummary } from '../components/forms/form-error-summary';
import { FormField } from '../components/forms/form-field';
import { SubmitButton } from '../components/forms/submit-button';

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
      const key = issue.path[0] ? String(issue.path[0]) : 'form';
      errors[key] ??= [];
      errors[key].push(issue.message);
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

  const navigation = useNavigation();
  const submit = useSubmit();
  const [showSuccess, setShowSuccess] = useState(false);

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

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Settings', href: location.pathname },
    ],
    [location.pathname]
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />

      <PageHeader title="Settings" description="Demo form for PR-018 validation patterns." />

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
    </div>
  );
}
