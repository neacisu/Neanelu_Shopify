import { useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Tabs } from '../components/ui/tabs';

const tabs = [
  { label: 'Prezentare', value: 'overview', path: '/pim' },
  { label: 'Calitate', value: 'quality', path: '/pim/quality' },
  { label: 'Enrichment', value: 'enrichment', path: '/pim/enrichment' },
  { label: 'Costuri', value: 'costs', path: '/pim/costs' },
  { label: 'Evenimente', value: 'events', path: '/pim/events' },
  { label: 'Consens', value: 'consensus', path: '/pim/consensus' },
];

function resolveActiveTab(pathname: string): string {
  if (pathname === '/pim') return 'overview';
  if (pathname.startsWith('/pim/quality')) return 'quality';
  if (pathname.startsWith('/pim/enrichment')) return 'enrichment';
  if (pathname.startsWith('/pim/costs')) return 'costs';
  if (pathname.startsWith('/pim/events')) return 'events';
  if (pathname.startsWith('/pim/consensus')) return 'consensus';
  return 'overview';
}

export default function PimLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = useMemo(() => resolveActiveTab(location.pathname), [location.pathname]);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/' },
          { label: 'PIM', href: '/pim' },
        ]}
      />
      <PageHeader
        title="Management informatii produs (PIM)"
        description="Progres Golden Record, pipeline de enrichment si analize de calitate."
      />
      <Tabs
        items={tabs}
        value={activeTab}
        ariaLabel="Sectiuni PIM"
        onValueChange={(value) => {
          const target = tabs.find((tab) => tab.value === value);
          if (!target) return;
          void navigate(target.path);
        }}
      />
      <div role="tabpanel" aria-label={`${activeTab} panel`}>
        <Outlet />
      </div>
    </div>
  );
}
