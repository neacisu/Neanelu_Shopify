import { useState } from 'react';

import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';
import { JsonViewer } from '../ui/JsonViewer';
import { WebhookDeliveryStatusBadge } from './WebhookDeliveryStatusBadge';

type Delivery = Readonly<{
  id: string;
  eventId: string;
  eventType: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  attempt: number;
  responseBody: string | null;
  errorMessage: string | null;
  createdAt: string;
}>;

export function WebhookDeliveriesTable(props: {
  deliveries: Delivery[];
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void | Promise<void>;
  onRetry?: (eventId: string) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  if (props.loading) {
    return (
      <div className="rounded-md border border-muted/20 bg-background p-4 text-sm text-muted dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-400">
        Se încarcă livrările…
      </div>
    );
  }

  if (props.deliveries.length === 0) {
    return (
      <div className="rounded-md border border-muted/20 bg-background p-4 text-sm text-muted dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-400">
        Nicio livrare încă.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-muted/20 bg-background p-4 dark:border-slate-700 dark:bg-slate-900/80">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium dark:text-slate-100">Istoric livrări</span>
        <InfoTooltip title="Istoric livrări webhook" side="bottom" portalToBody>
          Lista ultimelor notificări trimise către endpoint-ul tău, cu status HTTP, durată și
          numărul încercării. Click pe un rând pentru detalii complete și payload-ul JSON. De
          exemplu, un status 200 indică livrare reușită, iar 500 un eșec pe server. Sfat: pentru
          livrări eșuate, poți folosi butonul „Reîncearcă".
        </InfoTooltip>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted dark:text-slate-400">
            <tr>
              <th className="px-2 py-1 text-left">Eveniment</th>
              <th className="px-2 py-1 text-left">Status</th>
              <th className="px-2 py-1 text-right">HTTP</th>
              <th className="px-2 py-1 text-right">Durată</th>
              <th className="px-2 py-1 text-right">Încercare</th>
              <th className="px-2 py-1 text-right">Data</th>
            </tr>
          </thead>
          <tbody className="dark:text-slate-200">
            {props.deliveries.map((item) => {
              const failed = !item.httpStatus || item.httpStatus < 200 || item.httpStatus > 299;
              return (
                <tr
                  key={item.id}
                  className="cursor-pointer border-t border-muted/20 hover:bg-muted/10 dark:border-slate-700 dark:hover:bg-slate-800/50"
                  onClick={() => setExpanded((prev) => (prev === item.id ? null : item.id))}
                >
                  <td className="px-2 py-2">{item.eventType ?? 'necunoscut'}</td>
                  <td className="px-2 py-2">
                    <WebhookDeliveryStatusBadge status={failed ? 'failed' : 'sent'} />
                  </td>
                  <td className="px-2 py-2 text-right">{item.httpStatus ?? 'n/a'}</td>
                  <td className="px-2 py-2 text-right">{item.durationMs ?? 'n/a'} ms</td>
                  <td className="px-2 py-2 text-right">{item.attempt}</td>
                  <td className="px-2 py-2 text-right">
                    {new Date(item.createdAt).toLocaleString('ro-RO')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {expanded ? (
        <div className="space-y-2 rounded-md border border-muted/20 p-3 dark:border-slate-700 dark:bg-slate-800/50">
          {(() => {
            const row = props.deliveries.find((item) => item.id === expanded);
            if (!row) return null;
            const failed = !row.httpStatus || row.httpStatus < 200 || row.httpStatus > 299;
            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium dark:text-slate-100">Detalii livrare</div>
                  {failed && props.onRetry ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={retrying === row.eventId}
                      onClick={() => {
                        setRetrying(row.eventId);
                        void Promise.resolve(props.onRetry?.(row.eventId)).finally(() =>
                          setRetrying(null)
                        );
                      }}
                    >
                      {retrying === row.eventId ? 'Se reîncearcă…' : 'Reîncearcă'}
                    </Button>
                  ) : null}
                </div>
                {row.errorMessage ? (
                  <div className="rounded-md border border-error/30 bg-error/10 p-2 text-sm text-error dark:border-red-700/50 dark:bg-red-900/20">
                    {row.errorMessage}
                  </div>
                ) : null}
                <JsonViewer title="Răspuns server" value={row.responseBody ?? {}} maxHeight={200} />
              </>
            );
          })()}
        </div>
      ) : null}

      {props.hasMore && props.onLoadMore ? (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => void props.onLoadMore?.()}>
            Încarcă mai multe
          </Button>
        </div>
      ) : null}
    </div>
  );
}
