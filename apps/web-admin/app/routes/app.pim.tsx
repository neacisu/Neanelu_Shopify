import { useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Tabs } from '../components/ui/tabs';

const tabs = [
  { label: 'Overview', value: 'overview', path: '/pim' },
  { label: 'Quality', value: 'quality', path: '/pim/quality' },
  { label: 'Enrichment', value: 'enrichment', path: '/pim/enrichment' },
  { label: 'Costs', value: 'costs', path: '/pim/costs' },
  { label: 'Events', value: 'events', path: '/pim/events' },
  { label: 'Consensus', value: 'consensus', path: '/pim/consensus' },
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
        title="Product Information Management"
        description="Golden Record progress, enrichment pipeline si quality analytics."
      />
      <Tabs
        items={tabs}
        value={activeTab}
        ariaLabel="PIM sections"
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
