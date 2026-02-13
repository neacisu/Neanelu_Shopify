import { useState } from 'react';

import { Button } from '../ui/button';
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
      <div className="rounded-md border border-muted/20 bg-background p-4 text-sm text-muted">
        Loading deliveries...
      </div>
    );
  }

  if (props.deliveries.length === 0) {
    return (
      <div className="rounded-md border border-muted/20 bg-background p-4 text-sm text-muted">
        No deliveries yet.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-muted/20 bg-background p-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-2 py-1 text-left">Event</th>
              <th className="px-2 py-1 text-left">Status</th>
              <th className="px-2 py-1 text-right">HTTP</th>
              <th className="px-2 py-1 text-right">Duration</th>
              <th className="px-2 py-1 text-right">Attempt</th>
              <th className="px-2 py-1 text-right">Time</th>
            </tr>
          </thead>
          <tbody>
            {props.deliveries.map((item) => {
              const failed = !item.httpStatus || item.httpStatus < 200 || item.httpStatus > 299;
              return (
                <tr
                  key={item.id}
                  className="cursor-pointer border-t border-muted/20 hover:bg-muted/10"
                  onClick={() => setExpanded((prev) => (prev === item.id ? null : item.id))}
                >
                  <td className="px-2 py-2">{item.eventType ?? 'unknown'}</td>
                  <td className="px-2 py-2">
                    <WebhookDeliveryStatusBadge status={failed ? 'failed' : 'sent'} />
                  </td>
                  <td className="px-2 py-2 text-right">{item.httpStatus ?? 'n/a'}</td>
                  <td className="px-2 py-2 text-right">{item.durationMs ?? 'n/a'} ms</td>
                  <td className="px-2 py-2 text-right">{item.attempt}</td>
                  <td className="px-2 py-2 text-right">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {expanded ? (
        <div className="space-y-2 rounded-md border border-muted/20 p-3">
          {(() => {
            const row = props.deliveries.find((item) => item.id === expanded);
            if (!row) return null;
            const failed = !row.httpStatus || row.httpStatus < 200 || row.httpStatus > 299;
            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">Delivery detail</div>
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
                      {retrying === row.eventId ? 'Retrying...' : 'Retry'}
                    </Button>
                  ) : null}
                </div>
                {row.errorMessage ? (
                  <div className="rounded-md border border-error/30 bg-error/10 p-2 text-sm text-error">
                    {row.errorMessage}
                  </div>
                ) : null}
                <JsonViewer title="Response body" value={row.responseBody ?? {}} maxHeight={200} />
              </>
            );
          })()}
        </div>
      ) : null}

      {props.hasMore && props.onLoadMore ? (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => void props.onLoadMore?.()}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
