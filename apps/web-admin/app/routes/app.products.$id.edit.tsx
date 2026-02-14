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
import { useApiClient } from '../hooks/use-api';

const schema = z.object({
  titleMaster: z.string().min(1, 'Title is required'),
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
      { label: 'Home', href: '/' },
      { label: 'Products', href: '/products' },
      { label: product?.title ?? 'Edit', href: location.pathname },
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
      toast.success('Saved successfully');
    } else if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data, fetcher.state]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader title="Editeaza produs" description="Actualizeaza doar metadata PIM." />

      <form onSubmit={handleFormSubmit} className="space-y-4 rounded-lg border p-4">
        <div className="grid gap-3">
          <label className="text-xs text-muted">Title (master)</label>
          <input
            className="h-10 rounded-md border bg-background px-3 text-sm"
            {...form.register('titleMaster')}
          />
          {form.formState.errors.titleMaster ? (
            <div className="text-xs text-red-600">{form.formState.errors.titleMaster.message}</div>
          ) : null}
        </div>

        <div className="grid gap-3">
          <label className="text-xs text-muted">Description (master)</label>
          <textarea
            className="min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm"
            {...form.register('descriptionMaster')}
          />
        </div>

        <div className="grid gap-3">
          <label className="text-xs text-muted">Short description</label>
          <input
            className="h-10 rounded-md border bg-background px-3 text-sm"
            {...form.register('descriptionShort')}
          />
        </div>

        <div className="grid gap-3">
          <label className="text-xs text-muted">Metafields (JSON)</label>
          <textarea
            className="min-h-[140px] rounded-md border bg-background px-3 py-2 text-xs"
            {...form.register('metafields')}
          />
        </div>

        <div className="grid gap-3">
          <label className="text-xs text-muted">Taxonomy ID</label>
          <input
            className="h-10 rounded-md border bg-background px-3 text-sm"
            {...form.register('taxonomyId')}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-3">
            <label className="text-xs text-muted">Brand</label>
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              {...form.register('brand')}
            />
          </div>
          <div className="grid gap-3">
            <label className="text-xs text-muted">Manufacturer</label>
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              {...form.register('manufacturer')}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-3">
            <label className="text-xs text-muted">GTIN</label>
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              {...form.register('gtin')}
            />
          </div>
          <div className="grid gap-3">
            <label className="text-xs text-muted">MPN</label>
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              {...form.register('mpn')}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button">
            Cancel
          </Button>
          <Button variant="secondary" type="submit" loading={fetcher.state !== 'idle'}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  const id = params['id'];
  if (!id) {
    return { ok: false, error: 'Missing product id' };
  }
  const formData = await request.formData();
  const payload = Object.fromEntries(formData.entries());
  const response = await fetch(`/api/products/${id}/pim`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    return { ok: false, error: 'Failed to save' };
  }
  return { ok: true };
}
