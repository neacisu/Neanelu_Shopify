import { context as otelContext } from '@opentelemetry/api';

import { withSpan } from '@app/logger';
import {
  buildJobTelemetryFromActiveContext,
  extractOtelContextFromTelemetryMetadata,
} from '@app/queue-manager';

import { sdk } from './register.js';

await withSpan(
  'webhooks.enqueue',
  {
    'shop.domain': 'example.myshopify.com',
    'webhook.topic': 'app/uninstalled',
  },
  async () => {
    const telemetry = buildJobTelemetryFromActiveContext();

    await withSpan(
      'queue.enqueue',
      {
        'queue.name': 'webhook-queue',
        'queue.job.name': 'app/uninstalled',
      },
      async () => {
        // noop
      }
    );

    const extracted = extractOtelContextFromTelemetryMetadata(telemetry?.metadata);
    await otelContext.with(extracted, async () => {
      await withSpan(
        'queue.process',
        {
          'queue.name': 'webhook-queue',
          'queue.job.name': 'app/uninstalled',
        },
        async () => {
          // noop
        }
      );
    });
  }
);

// Force flush/export for smoke test
await sdk?.shutdown();
