/**
 * Module H: Audit & Observability - audit_logs
 *
 * CONFORM: Plan_de_implementare.md F2.2.4.1
 * NOTE: Table is partitioned via SQL migrations; Drizzle schema models the parent table.
 */

import { pgTable, uuid, text, timestamp, jsonb, customType, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { shops } from './shops.ts';

const inet = customType<{ data: string | null }>({
  dataType() {
    return 'inet';
  },
  fromDriver(value: unknown) {
    if (value === null) return null;
    if (typeof value === 'string') return value;
    throw new TypeError(`inet: expected string, got ${typeof value}`);
  },
  toDriver(value: string | null) {
    return value;
  },
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),

    action: text('action').notNull(),
    actorType: text('actor_type'),
    actorId: uuid('actor_id'),

    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),

    resourceType: text('resource_type'),
    resourceId: uuid('resource_id'),

    details: jsonb('details').notNull().default({}),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    traceId: text('trace_id'),
    spanId: text('span_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_audit_shop').on(table.shopId, table.createdAt),
    index('idx_audit_action').on(table.action, table.createdAt),
    index('idx_audit_trace').on(table.traceId),
  ]
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
