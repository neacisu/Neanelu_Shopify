/**
 * Webhook Queue Producer (compat shim)
 *
 * Kept for backwards-compatible imports inside backend-worker tests and modules.
 * Source of truth lives in `@app/queue-manager`.
 */

export {
  WEBHOOK_QUEUE_NAME,
  enqueueWebhookJob,
  closeWebhookQueue,
  cleanupWebhookJobsForShopDomain,
} from '@app/queue-manager';
