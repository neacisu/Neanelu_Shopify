import { Search } from 'lucide-react';

import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { EmptyState } from '../components/patterns';

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
      <EmptyState
        icon={Search}
        title="No searches yet"
        description="This page will provide AI-assisted search once the search API is wired up."
      />
    </div>
  );
}
