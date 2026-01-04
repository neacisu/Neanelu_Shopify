import { useEffect, useMemo, useRef } from 'react';
import type { ActionFunctionArgs } from 'react-router-dom';
import { Form, useActionData, useLocation } from 'react-router-dom';
import { z } from 'zod';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { FieldError } from '../components/forms/field-error';
import { FormErrorSummary } from '../components/forms/form-error-summary';

const SettingsSchema = z.object({
  email: z.string().email('Email invalid'),
  shopDomain: z
    .string()
    .min(1, 'Shop domain este obligatoriu')
    .regex(/^[a-z0-9-]+\.myshopify\.com$/i, 'Format: store.myshopify.com'),
});

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

  const emailRef = useRef<HTMLInputElement | null>(null);
  const shopDomainRef = useRef<HTMLInputElement | null>(null);

  const errors = actionData?.ok === false ? actionData.errors : undefined;

  useEffect(() => {
    if (!errors) return;

    if (errors['email']?.length) {
      emailRef.current?.focus();
      return;
    }

    if (errors['shopDomain']?.length) {
      shopDomainRef.current?.focus();
    }
  }, [errors]);

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

      <Form method="post" className="space-y-4" noValidate>
        <div>
          <label className="text-caption text-muted" htmlFor="email">
            Email
          </label>
          <input
            ref={emailRef}
            id="email"
            name="email"
            type="email"
            className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-describedby={errors?.['email']?.length ? 'email-error' : undefined}
          />
          <FieldError name="email" errors={errors} />
        </div>

        <div>
          <label className="text-caption text-muted" htmlFor="shopDomain">
            Shop Domain
          </label>
          <input
            ref={shopDomainRef}
            id="shopDomain"
            name="shopDomain"
            className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="store.myshopify.com"
            aria-describedby={errors?.['shopDomain']?.length ? 'shopDomain-error' : undefined}
          />
          <FieldError name="shopDomain" errors={errors} />
        </div>

        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-body text-background shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Save
        </button>
      </Form>

      {actionData?.ok === true ? (
        <div className="rounded-md border border-success/30 bg-success/10 p-4 text-success shadow-sm">
          Saved.
        </div>
      ) : null}
    </div>
  );
}
