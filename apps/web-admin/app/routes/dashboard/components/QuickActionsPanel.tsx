import { RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';

import type { ComponentType } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { DashboardClearCacheResponse, DashboardStartSyncResponse } from '@app/types';

import { PolarisCard } from '../../../../components/polaris/index.js';
import { createApiClient } from '../../../lib/api-client';
import { getSessionAuthHeaders } from '../../../lib/session-auth';
import { Button } from '../../../components/ui/button';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { InfoTooltip } from '../../../components/ui/info-tooltip';

const api = createApiClient({ getAuthHeaders: getSessionAuthHeaders });

interface QuickAction {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  variant: 'primary' | 'secondary';
  tooltipTitle: string;
  tooltipBody: string;
  onClick: () => void;
}

export function QuickActionsPanel() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const actions: QuickAction[] = [
    {
      id: 'reconcile',
      label: 'Reconcile Webhooks',
      icon: RefreshCw,
      variant: 'primary',
      tooltipTitle: 'Reconciliere Webhooks',
      tooltipBody:
        'Shopify trimite notificări automate (webhooks) către Neanelu de fiecare dată când se modifică ' +
        'ceva în magazin. Uneori aceste notificări se pot pierde. Acest buton verifică lista completă ' +
        'de notificări așteptate și le recreează pe cele lipsă. Poate fi folosit o singură dată pe oră. ' +
        'Folosește-l dacă observi că modificările din Shopify nu se mai reflectă în Neanelu.',
      onClick: () => {
        void (async () => {
          setLoadingId('reconcile');
          try {
            const res = await api.postApi<DashboardStartSyncResponse, Record<string, never>>(
              '/dashboard/actions/start-sync',
              {}
            );
            toast.success(`Webhook reconcile enqueued (${res.jobId})`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to reconcile webhooks');
          } finally {
            setLoadingId(null);
          }
        })();
      },
    },
    {
      id: 'clear-cache',
      label: 'Clear Cache',
      icon: Trash2,
      variant: 'secondary',
      tooltipTitle: 'Golire Cache',
      tooltipBody:
        'Aplicația păstrează în memorie anumite date folosite frecvent (statistici, filtre, numere) ' +
        'pentru a fi mai rapidă. Acest buton șterge acele copii temporare, forțând reîncărcarea datelor ' +
        'proaspete din baza de date. Nu se șterge niciun produs sau setare — doar cache-ul de viteză. ' +
        'Folosește-l dacă vezi numere care par vechi sau greșite pe dashboard.',
      onClick: () => setConfirmOpen(true),
    },
    {
      id: 'health',
      label: 'Check Health',
      icon: ShieldCheck,
      variant: 'secondary',
      tooltipTitle: 'Verificare Sănătate Sistem',
      tooltipBody:
        'Rulează un control rapid al tuturor componentelor: baza de date, memoria cache (Redis), ' +
        'conexiunea la Shopify și toți procesatorii din spate. Dacă totul funcționează corect, ' +
        'vei vedea un mesaj verde „OK". Dacă ceva nu merge, vei fi notificat ce anume are probleme. ' +
        'Folosește-l oricând vrei să te asiguri rapid că aplicația funcționează normal.',
      onClick: () => {
        void (async () => {
          setLoadingId('health');
          try {
            await api.getJson('/health/ready');
            toast.success('Health check OK');
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Health check failed');
          } finally {
            setLoadingId(null);
          }
        })();
      },
    },
  ];

  return (
    <PolarisCard>
      <div className="rounded-md border border-muted/20 bg-background p-4 shadow-sm">
        <div>
          <div className="text-h3">Quick Actions</div>
          <div className="mt-1 text-caption text-muted">
            Common operations without leaving the dashboard
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {actions.map((action) => {
            const Icon = action.icon;
            const isLoading = loadingId === action.id;

            return (
              <div key={action.id} className="group/action relative flex flex-col gap-1.5">
                <Button
                  variant={action.variant}
                  loading={isLoading}
                  disabled={isLoading}
                  onClick={action.onClick}
                  className="w-full transition-all duration-300 ease-out
                             hover:shadow-md hover:-translate-y-0.5
                             active:translate-y-0 active:shadow-sm"
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon
                      className={`size-4 transition-transform duration-300
                        ${isLoading ? 'animate-spin' : 'group-hover/action:rotate-12'}`}
                    />
                    {action.label}
                  </span>
                </Button>

                <div className="flex items-center justify-center">
                  <InfoTooltip title={action.tooltipTitle}>{action.tooltipBody}</InfoTooltip>
                </div>
              </div>
            );
          })}
        </div>

        <ConfirmDialog
          open={confirmOpen}
          title="Clear Redis cache?"
          description="This will remove selected cache key patterns from Redis. Queue data and long-lived keys are not touched."
          confirmLabel="Clear"
          cancelLabel="Cancel"
          destructive
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => {
            void (async () => {
              setLoadingId('clear-cache');
              try {
                const res = await api.postApi<
                  DashboardClearCacheResponse,
                  { confirm: true; patterns: string[] }
                >('/dashboard/actions/clear-cache', {
                  confirm: true,
                  patterns: ['dashboard:*', 'cache:*'],
                });
                toast.success(`Cache cleared (${res.deletedKeys} keys)`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Failed to clear cache');
              } finally {
                setLoadingId(null);
              }
            })();
          }}
        />
      </div>
    </PolarisCard>
  );
}
