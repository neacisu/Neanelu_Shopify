import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';

export default function SearchPage() {
  const location = useLocation();

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Search', href: location.pathname },
    ],
    [location.pathname]
  );

  return (
    <div className="space-y-4">
      <Breadcrumbs items={breadcrumbs} />
      <h1 className="text-h2">AI Search Playground</h1>
      <p className="text-body text-muted">Placeholder page for PR-018.</p>
    </div>
  );
}
