import { Database } from 'lucide-react';

import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { EmptyState } from '../components/patterns';

export default function IngestionPage() {
  const location = useLocation();

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Ingestion', href: location.pathname },
    ],
    [location.pathname]
  );

  return (
    <div className="space-y-4">
      <Breadcrumbs items={breadcrumbs} />
      <h1 className="text-h2">Bulk Ingestion</h1>
      <EmptyState
        icon={Database}
        title="No ingestion runs yet"
        description="This page will show bulk ingestion status once ingestion flows are implemented."
      />
    </div>
  );
}
