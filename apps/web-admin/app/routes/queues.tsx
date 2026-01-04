import { useMemo } from 'react';
import type { LoaderFunctionArgs } from 'react-router-dom';
import { useLoaderData, useLocation } from 'react-router-dom';

import { handleApiError } from '../utils/handle-api-error';
import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { EmptyState } from '../components/patterns';

export function loader({ request }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode');

    if (mode === '404') {
      // React Router loaders intentionally throw Response objects.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw new Response('Not Found', { status: 404 });
    }

    if (mode === '500') {
      throw new Error('Simulated server error');
    }

    return { ok: true };
  } catch (e) {
    handleApiError(e);
  }
}

export default function QueuesPage() {
  useLoaderData();
  const location = useLocation();

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Queues', href: location.pathname },
    ],
    [location.pathname]
  );

  return (
    <div className="space-y-4">
      <Breadcrumbs items={breadcrumbs} />
      <h1 className="text-h2">Queue Monitor</h1>
      <EmptyState
        title="No queue data yet"
        description={
          <>
            Placeholder page. Try <span className="font-mono">?mode=404</span> or{' '}
            <span className="font-mono">?mode=500</span> to validate error handling.
          </>
        }
      />
    </div>
  );
}
