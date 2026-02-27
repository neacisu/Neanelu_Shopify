import { useEffect, useMemo, useState } from 'react';
import { useFetcher, useLocation, useParams, type ActionFunctionArgs } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

import type { ProductDetail } from '@app/types';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Button } from '../components/ui/button';
import { InfoTooltip } from '../components/ui/info-tooltip';
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
    if (!id) return;
    void api.getApi<ProductDetail>(`/products/${id}`).then((data) => {
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

  return (
    <div className="space-y-6 dark:text-slate-100">
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader title="Editeaza produs" description="Actualizeaza doar metadata PIM." />

      <form
        onSubmit={handleFormSubmit}
        className="space-y-4 rounded-lg border border-border dark:border-slate-700 bg-white dark:bg-slate-900/80 p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-sm)]"
      >
        <div className="grid gap-3">
          <label className="flex items-center gap-1 text-xs text-muted dark:text-slate-400">
            Titlu (master)
            <InfoTooltip title="Titlu master">
              Titlul principal al produsului în sistemul PIM. Se folosește pentru căutare și
              afișare.
            </InfoTooltip>
          </label>
          <input
            className="h-10 rounded-md border border-border dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm dark:text-slate-200 transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
            {...form.register('titleMaster')}
          />
          {form.formState.errors.titleMaster ? (
            <div className="text-xs text-error">{form.formState.errors.titleMaster.message}</div>
          ) : null}
        </div>

        <div className="grid gap-3">
          <label className="flex items-center gap-1 text-xs text-muted dark:text-slate-400">
            Descriere (master)
            <InfoTooltip title="Descriere master">
              Descrierea completă a produsului. Apare în paginile de produs din magazin.
            </InfoTooltip>
          </label>
          <textarea
            className="min-h-[120px] rounded-md border border-border dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-200 transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
            {...form.register('descriptionMaster')}
          />
        </div>

        <div className="grid gap-3">
          <label className="flex items-center gap-1 text-xs text-muted dark:text-slate-400">
            Descriere scurtă
            <InfoTooltip title="Descriere scurtă">
              Rezumat pentru liste și rezultate de căutare. Până la câteva propoziții.
            </InfoTooltip>
          </label>
          <input
            className="h-10 rounded-md border border-border dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm dark:text-slate-200 transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
            {...form.register('descriptionShort')}
          />
        </div>

        <div className="grid gap-3">
          <label className="flex items-center gap-1 text-xs text-muted dark:text-slate-400">
            Metafields (JSON)
            <InfoTooltip title="Metafields JSON">
              Câmpuri personalizate în format JSON. Modificările se aplică doar în baza locală PIM.
            </InfoTooltip>
          </label>
          <textarea
            className="min-h-[140px] rounded-md border border-border dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs dark:text-slate-200 transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
            {...form.register('metafields')}
          />
        </div>

        <div className="grid gap-3">
          <label className="flex items-center gap-1 text-xs text-muted dark:text-slate-400">
            ID taxonomie
            <InfoTooltip title="Taxonomie">
              Categoria din schema de clasificare a produsului (ex. electronice, îmbrăcăminte).
            </InfoTooltip>
          </label>
          <input
            className="h-10 rounded-md border border-border dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm dark:text-slate-200 transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
            {...form.register('taxonomyId')}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-3">
            <label className="flex items-center gap-1 text-xs text-muted dark:text-slate-400">
              Marcă
              <InfoTooltip title="Marcă produs">
                Brandul comercial al produsului. Ajută la identificare și filtrare în catalog.
                Exemplu: „Nike", „Samsung". Completează cât mai corect pentru căutări precise.
              </InfoTooltip>
            </label>
            <input
              className="h-10 rounded-md border border-border dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm dark:text-slate-200 transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
              {...form.register('brand')}
            />
          </div>
          <div className="grid gap-3">
            <label className="flex items-center gap-1 text-xs text-muted dark:text-slate-400">
              Producător
              <InfoTooltip title="Producător">
                Compania care fabrică produsul. Poate diferi de marcă (ex. producătorul poate fi o
                fabrică terță). Util pentru evidențe interne și traceabilitate.
              </InfoTooltip>
            </label>
            <input
              className="h-10 rounded-md border border-border dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm dark:text-slate-200 transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
              {...form.register('manufacturer')}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-3">
            <label className="flex items-center gap-1 text-xs text-muted dark:text-slate-400">
              GTIN
              <InfoTooltip title="GTIN">
                Cod de bare global (EAN/UPC). Identifică unic produsul în sistemele de retail.
              </InfoTooltip>
            </label>
            <input
              className="h-10 rounded-md border border-border dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm dark:text-slate-200 transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
              {...form.register('gtin')}
            />
          </div>
          <div className="grid gap-3">
            <label className="flex items-center gap-1 text-xs text-muted dark:text-slate-400">
              MPN
              <InfoTooltip title="MPN">
                Număr de piesă producător. Cod intern al fabricantului pentru identificare.
              </InfoTooltip>
            </label>
            <input
              className="h-10 rounded-md border border-border dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm dark:text-slate-200 transition-shadow duration-200 focus:ring-2 focus:ring-blue-500/40 dark:focus:ring-blue-400/50"
              {...form.register('mpn')}
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
