/**
 * Audit helper
 *
 * CONFORM: Plan_de_implementare.md F2.2.4.1
 */

import { db, withTenantContext } from './db.js';
import { auditLogs } from './schema/audit.js';

export type AuditActorType = 'user' | 'system' | 'scheduler' | 'webhook';

export type AuditAction =
  | 'oauth_login_success'
  | 'oauth_login_failed'
  | 'oauth_token_refresh'
  | 'bulk_operation_started'
  | 'bulk_operation_completed'
  | 'bulk_operation_failed'
  | 'key_rotation_initiated'
  | 'key_rotation_completed'
  | 'rate_limit_changed'
  | 'config_changed'
  | 'data_export_requested'
  | 'admin_action'
  | (string & {});

export interface AuditContext {
  actorType?: AuditActorType;
  actorId?: string | null;
  shopId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  traceId?: string | null;
  spanId?: string | null;
}

export async function logAuditEvent(action: AuditAction, context: AuditContext): Promise<void> {
  const values = {
    action,
    actorType: context.actorType ?? 'system',
    actorId: context.actorId ?? null,
    shopId: context.shopId ?? null,
    resourceType: context.resourceType ?? null,
    resourceId: context.resourceId ?? null,
    details: context.details ?? {},
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
    traceId: context.traceId ?? null,
    spanId: context.spanId ?? null,
  };

  if (context.shopId) {
    await withTenantContext(context.shopId, async (client) => {
      const cols = Object.keys(values);
      const vals = Object.values(values).map((v) =>
        v !== null && typeof v === 'object' ? JSON.stringify(v) : v
      );
      const placeholders = vals.map((_, i) => `$${i + 1}`);
      await client.query(
        `INSERT INTO audit_logs (${cols.map(camelToSnake).join(', ')}) VALUES (${placeholders.join(', ')})`,
        vals
      );
    });
  } else {
    await db.insert(auditLogs).values(values);
  }
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
