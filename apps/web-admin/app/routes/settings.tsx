import { useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { Tabs } from '../components/ui/tabs';

const tabs = [
  { label: 'General', value: 'general' },
  { label: 'API & Webhooks', value: 'api' },
  { label: 'Queues', value: 'queues' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Serper', value: 'serper' },
  { label: 'xAI Grok', value: 'xai' },
];

function resolveActiveTab(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? 'general';
  if (last === 'settings') return 'general';
  if (tabs.some((tab) => tab.value === last)) return last;
  return 'general';
}

export default function SettingsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = useMemo(() => resolveActiveTab(location.pathname), [location.pathname]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Settings', href: '/settings' }]} />
      <PageHeader title="Settings" description="Manage shop preferences and integrations." />
      <Tabs
        items={tabs}
        value={activeTab}
        onValueChange={(value) => {
          void navigate(`/settings/${value}`);
        }}
      />
      <Outlet />
    </div>
  );
}
