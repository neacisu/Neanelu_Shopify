import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useRouteError } from 'react-router-dom';
import type { LexBootstrapDto } from '@app/types';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { Tabs } from '../components/ui/tabs';
import { ErrorState } from '../components/patterns/error-state';
import { useApiClient } from '../hooks/use-api';

const tabs = [
  { label: 'Prezentare', value: 'overview', path: '/pim' },
  { label: 'Calitate', value: 'quality', path: '/pim/quality' },
  { label: 'Enrichment', value: 'enrichment', path: '/pim/enrichment' },
  { label: 'Costuri', value: 'costs', path: '/pim/costs' },
  { label: 'Evenimente', value: 'events', path: '/pim/events' },
  { label: 'Consens', value: 'consensus', path: '/pim/consensus' },
  { label: 'Categorii', value: 'categories', path: '/pim/categories' },
  { label: 'Traduceri', value: 'translations', path: '/pim/translations' },
  { label: 'Configurare', value: 'config', path: '/pim/config' },
];

function resolveActiveTab(pathname: string): string {
  if (pathname === '/pim') return 'overview';
  if (pathname.startsWith('/pim/quality')) return 'quality';
  if (pathname.startsWith('/pim/enrichment')) return 'enrichment';
  if (pathname.startsWith('/pim/costs')) return 'costs';
  if (pathname.startsWith('/pim/events')) return 'events';
  if (pathname.startsWith('/pim/consensus')) return 'consensus';
  if (pathname.startsWith('/pim/categories')) return 'categories';
  if (pathname.startsWith('/pim/translations')) return 'translations';
  if (pathname.startsWith('/pim/config')) return 'config';
  return 'overview';
}

export default function PimLayout() {
  const api = useApiClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [lexBootstrap, setLexBootstrap] = useState<LexBootstrapDto | null>(null);
  const activeTab = useMemo(() => resolveActiveTab(location.pathname), [location.pathname]);
  const visibleTabs = useMemo(
    () =>
      tabs.filter(
        (tab) => tab.value !== 'translations' || lexBootstrap?.permissions.canView === true
      ),
    [lexBootstrap]
  );

  useEffect(() => {
    let cancelled = false;

    void api
      .getApi<{ bootstrap: LexBootstrapDto }>('/pim/lex/bootstrap')
      .then((response) => {
        if (!cancelled) setLexBootstrap(response.bootstrap);
      })
      .catch(() => {
        if (!cancelled) setLexBootstrap(null);
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (activeTab !== 'translations') return;
    if (lexBootstrap == null) return;
    if (lexBootstrap.permissions.canView) return;
    void navigate('/pim', { replace: true });
  }, [activeTab, lexBootstrap, navigate]);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Acasă', href: '/' },
          { label: 'PIM', href: '/pim' },
        ]}
      />
      <PageHeader
        title="Management informații produs (PIM)"
        description="Progres Golden Record, pipeline de enrichment și analize de calitate."
        actions={
          <InfoTooltip title="PIM" side="bottom" portalToBody>
            PIM este centrul de informații despre calitatea datelor produs. De ce contează: oferă
            vizibilitate totală asupra Golden Records, enrichment și costuri. Exemplu: poți vedea
            câte produse au nivel Golden și rata de succes. Sfat: folosește taburile pentru navigare
            rapidă între secțiuni.
          </InfoTooltip>
        }
      />
      <span className="inline-flex items-center gap-1.5">
        <Tabs
          items={visibleTabs}
          value={activeTab}
          ariaLabel="Secțiuni PIM"
          onValueChange={(value) => {
            const target = visibleTabs.find((tab) => tab.value === value);
            if (!target) return;
            void navigate(target.path);
          }}
        />
        <InfoTooltip title="Secțiuni PIM" side="bottom">
          Secțiunile PIM acoperă fiecare aspect al datelor produs. De ce contează: fiecare tab oferă
          o perspectivă diferită — calitate, enrichment, costuri, evenimente și consens. Exemplu:
          Calitate arată niveluri Bronze/Silver/Golden, iar Costuri bugetele AI. Sfat: începe cu
          Prezentare pentru un overview rapid.
        </InfoTooltip>
      </span>
      <div
        role="tabpanel"
        aria-label={`${activeTab} panel`}
        className="motion-safe:animate-[fadeIn_0.3s_ease-out]"
        key={activeTab}
      >
        <Outlet />
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message =
    error instanceof Error ? error.message : 'A apărut o eroare neașteptată în modulul PIM.';
  return <ErrorState message={message} />;
}
