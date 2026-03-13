import { useEffect, useMemo, useState } from 'react';
import { useFetcher, useLocation, useParams, type ActionFunctionArgs } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

import type { ProductDetail } from '@app/types';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Button } from '../components/ui/button';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { TextField } from '../components/ui/text-field';
import { LoadingState } from '../components/patterns/loading-state';
import { ErrorState } from '../components/patterns/error-state';
import { useApiClient } from '../hooks/use-api';

const schema = z.object({
  titleMaster: z.string().min(1, 'Titlul este obligatoriu'),
  descriptionMaster: z.string().optional(),
  descriptionShort: z.string().optional(),
  taxonomyId: z.string().optional(),
  brand: z.string().optional(),
  manufacturer: z.string().optional(),
  gtin: z.string().optional(),
  mpn: z.string().optional(),
  metafields: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function ProductEditPage() {
  const location = useLocation();
  const params = useParams<{ id: string }>();
  const api = useApiClient();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      titleMaster: '',
      descriptionMaster: '',
      descriptionShort: '',
      taxonomyId: '',
      brand: '',
      manufacturer: '',
      gtin: '',
      mpn: '',
      metafields: '',
    },
  });

  const breadcrumbs = useMemo(
    () => [
      { label: 'Acasă', href: '/' },
      { label: 'Produse', href: '/products' },
      { label: product?.title ?? 'Editare', href: location.pathname },
    ],
    [location.pathname, product?.title]
  );

  useEffect(() => {
    const id = params.id;
    if (!id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    void api
      .getApi<ProductDetail>(`/products/${id}`)
      .then((data) => {
        setProduct(data);
        form.reset({
          titleMaster: data.pim?.titleMaster ?? data.title,
          descriptionMaster: data.pim?.descriptionMaster ?? data.description ?? '',
          descriptionShort: data.pim?.descriptionShort ?? '',
          taxonomyId: data.pim?.taxonomyId ?? '',
          brand: data.pim?.brand ?? '',
          manufacturer: data.pim?.manufacturer ?? '',
          gtin: data.pim?.gtin ?? '',
          mpn: data.pim?.mpn ?? '',
          metafields: data.metafields ? JSON.stringify(data.metafields, null, 2) : '',
        });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Eroare la încărcarea produsului';
        setLoadError(msg);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [api, form, params.id]);

  const onSubmit = (values: FormValues) => {
    if (!params.id) return;
    const formData = new FormData();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined) formData.append(key, value);
    });
    void fetcher.submit(formData, { method: 'post' });
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    void form.handleSubmit(onSubmit)(e);
  };

  useEffect(() => {
    if (fetcher.state !== 'idle') return;
    if (fetcher.data?.ok) {
      toast.success('Modificări salvate');
    } else if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data, fetcher.state]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={breadcrumbs} />
        <PageHeader title="Editează produs" description="Actualizeaza doar metadata PIM." />
        <LoadingState />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={breadcrumbs} />
        <PageHeader title="Editează produs" description="Actualizeaza doar metadata PIM." />
        <ErrorState message={loadError} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader title="Editează produs" description="Actualizeaza doar metadata PIM." />

      <form
        onSubmit={handleFormSubmit}
        className="space-y-4 rounded-lg border border-border bg-card p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-sm)]"
      >
        <div className="grid gap-3">
          <div className="flex items-center gap-1 text-xs text-muted">
            Titlu (master)
            <InfoTooltip title="Titlu master">
              Titlul principal al produsului în sistemul PIM. Se folosește pentru căutare și
              afișare.
            </InfoTooltip>
          </div>
          <Controller
            name="titleMaster"
            control={form.control}
            render={({ field, fieldState }) => (
              <TextField
                label="Titlu (master)"
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid ? true : undefined}
                {...(fieldState.error?.message ? { error: fieldState.error.message } : {})}
              />
            )}
          />
        </div>

        <div className="grid gap-3">
          <label htmlFor="descriptionMaster" className="flex items-center gap-1 text-xs text-muted">
            Descriere (master)
            <InfoTooltip title="Descriere master">
              Descrierea completă a produsului. Apare în paginile de produs din magazin.
            </InfoTooltip>
          </label>
          <Controller
            name="descriptionMaster"
            control={form.control}
            render={({ field, fieldState }) => (
              <textarea
                id="descriptionMaster"
                className="focus-ring-standard min-h-[120px] rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground transition-[border-color,box-shadow,background-color] duration-normal hover:border-accent-border aria-[invalid=true]:border-error"
                aria-invalid={fieldState.invalid ? true : undefined}
                {...field}
              />
            )}
          />
        </div>

        <div className="grid gap-3">
          <div className="flex items-center gap-1 text-xs text-muted">
            Descriere scurtă
            <InfoTooltip title="Descriere scurtă">
              Rezumat pentru liste și rezultate de căutare. Până la câteva propoziții.
            </InfoTooltip>
          </div>
          <Controller
            name="descriptionShort"
            control={form.control}
            render={({ field, fieldState }) => (
              <TextField
                label="Descriere scurtă"
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid ? true : undefined}
                {...(fieldState.error?.message ? { error: fieldState.error.message } : {})}
              />
            )}
          />
        </div>

        <div className="grid gap-3">
          <label htmlFor="metafields" className="flex items-center gap-1 text-xs text-muted">
            Metafields (JSON)
            <InfoTooltip title="Metafields JSON">
              Câmpuri personalizate în format JSON. Modificările se aplică doar în baza locală PIM.
            </InfoTooltip>
          </label>
          <Controller
            name="metafields"
            control={form.control}
            render={({ field, fieldState }) => (
              <textarea
                id="metafields"
                className="focus-ring-standard min-h-[140px] rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground transition-[border-color,box-shadow,background-color] duration-normal hover:border-accent-border aria-[invalid=true]:border-error"
                aria-invalid={fieldState.invalid ? true : undefined}
                {...field}
              />
            )}
          />
        </div>

        <div className="grid gap-3">
          <div className="flex items-center gap-1 text-xs text-muted">
            ID taxonomie
            <InfoTooltip title="Taxonomie">
              Categoria din schema de clasificare a produsului (ex. electronice, îmbrăcăminte).
            </InfoTooltip>
          </div>
          <Controller
            name="taxonomyId"
            control={form.control}
            render={({ field, fieldState }) => (
              <TextField
                label="ID taxonomie"
                value={field.value ?? ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid ? true : undefined}
                {...(fieldState.error?.message ? { error: fieldState.error.message } : {})}
              />
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-3">
            <div className="flex items-center gap-1 text-xs text-muted">
              Marcă
              <InfoTooltip title="Marcă produs">
                Brandul comercial al produsului. Ajută la identificare și filtrare în catalog.
                Exemplu: „Nike", „Samsung". Completează cât mai corect pentru căutări precise.
              </InfoTooltip>
            </div>
            <Controller
              name="brand"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextField
                  label="Marcă"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  aria-invalid={fieldState.invalid ? true : undefined}
                  {...(fieldState.error?.message ? { error: fieldState.error.message } : {})}
                />
              )}
            />
          </div>
          <div className="grid gap-3">
            <div className="flex items-center gap-1 text-xs text-muted">
              Producător
              <InfoTooltip title="Producător">
                Compania care fabrică produsul. Poate diferi de marcă (ex. producătorul poate fi o
                fabrică terță). Util pentru evidențe interne și traceabilitate.
              </InfoTooltip>
            </div>
            <Controller
              name="manufacturer"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextField
                  label="Producător"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  aria-invalid={fieldState.invalid ? true : undefined}
                  {...(fieldState.error?.message ? { error: fieldState.error.message } : {})}
                />
              )}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-3">
            <div className="flex items-center gap-1 text-xs text-muted">
              GTIN
              <InfoTooltip title="GTIN">
                Cod de bare global (EAN/UPC). Identifică unic produsul în sistemele de retail.
              </InfoTooltip>
            </div>
            <Controller
              name="gtin"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextField
                  label="GTIN"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  aria-invalid={fieldState.invalid ? true : undefined}
                  {...(fieldState.error?.message ? { error: fieldState.error.message } : {})}
                />
              )}
            />
          </div>
          <div className="grid gap-3">
            <div className="flex items-center gap-1 text-xs text-muted">
              MPN
              <InfoTooltip title="MPN">
                Număr de piesă producător. Cod intern al fabricantului pentru identificare.
              </InfoTooltip>
            </div>
            <Controller
              name="mpn"
              control={form.control}
              render={({ field, fieldState }) => (
                <TextField
                  label="MPN"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  aria-invalid={fieldState.invalid ? true : undefined}
                  {...(fieldState.error?.message ? { error: fieldState.error.message } : {})}
                />
              )}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={() => window.history.back()}>
            Anulare
          </Button>
          <Button variant="secondary" type="submit" loading={fetcher.state !== 'idle'}>
            Salvează modificările
          </Button>
        </div>
      </form>
    </div>
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  const id = params['id'];
  if (!id) {
    return { ok: false, error: 'Lipsește ID-ul produsului' };
  }
  const formData = await request.formData();
  const payload = Object.fromEntries(formData.entries());
  const response = await fetch(`/api/products/${id}/pim`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    return { ok: false, error: 'Salvarea a eșuat' };
  }
  return { ok: true };
}
