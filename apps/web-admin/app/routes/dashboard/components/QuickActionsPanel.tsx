import { ExternalLink, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { DashboardClearCacheResponse, DashboardStartSyncResponse } from '@app/types';

import { PolarisCard } from '../../../../components/polaris/index.js';
import { createApiClient } from '../../../lib/api-client';
import { getSessionAuthHeaders } from '../../../lib/session-auth';
import { Button } from '../../../components/ui/button';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';

const api = createApiClient({ getAuthHeaders: getSessionAuthHeaders });

export function QuickActionsPanel() {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const logsHref = useMemo(() => {
    // Best-effort: in docker-compose setups this is usually reverse-proxied.
    return '/grafana';
  }, []);

  return (
    <PolarisCard>
      <div className="rounded-md border border-muted/20 bg-background p-4 shadow-sm">
        <div>
          <div className="text-h3">Quick Actions</div>
          <div className="mt-1 text-caption text-muted">
            Common operations without leaving the dashboard
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Button
            variant="primary"
            onClick={() => {
              void (async () => {
                try {
                  const res = await api.postApi<DashboardStartSyncResponse, Record<string, never>>(
                    '/dashboard/actions/start-sync',
                    {}
                  );
                  toast.success(`Webhook reconcile enqueued (${res.jobId})`);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to reconcile webhooks');
                }
              })();
            }}
          >
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="size-4" />
              Reconcile Webhooks
            </span>
          </Button>

          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            <span className="inline-flex items-center gap-2">
              <Trash2 className="size-4" />
              Clear Cache
            </span>
          </Button>

          <Button
            variant="secondary"
            onClick={() => {
              void (async () => {
                try {
                  await api.getJson('/health/ready');
                  toast.success('Health check OK');
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Health check failed');
                }
              })();
            }}
          >
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-4" />
              Check Health
            </span>
          </Button>

          <Button
            variant="secondary"
            onClick={() => {
              window.open(logsHref, '_blank', 'noopener,noreferrer');
            }}
          >
            <span className="inline-flex items-center gap-2">
              <ExternalLink className="size-4" />
              View Logs
            </span>
          </Button>
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
              }
            })();
          }}
        />
      </div>
    </PolarisCard>
  );
}
