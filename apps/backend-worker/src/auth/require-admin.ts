import type { FastifyReply, FastifyRequest } from 'fastify';
import { withTenantContext } from '@app/database';
import type { SessionData } from './session.js';

export async function hasAdminAccess(session: SessionData): Promise<boolean> {
  if (!session.shopId) return false;

  const actorId = session.staffUserId ?? null;
  const actorEmail = session.staffEmail ?? null;

  if (!actorId && !actorEmail) return false;

  const result = await withTenantContext(session.shopId, (client) =>
    client.query<{ role: { admin?: boolean } | null }>(
      `SELECT role
       FROM staff_users
       WHERE shop_id = $1
         AND (
           ($2::uuid IS NOT NULL AND id = $2::uuid)
           OR ($2::uuid IS NULL AND $3::text IS NOT NULL AND lower(email) = $3::text)
         )
       LIMIT 1`,
      [session.shopId, actorId, actorEmail]
    )
  );

  return result.rows[0]?.role?.admin === true;
}

export function requireAdmin() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as FastifyRequest & { session?: SessionData }).session;
    if (!session?.shopId) {
      await reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Session required' },
        meta: { request_id: request.id, timestamp: new Date().toISOString() },
      });
      return;
    }

    try {
      const isAdmin = await hasAdminAccess(session);
      if (!isAdmin) {
        await reply.status(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Admin access required' },
          meta: { request_id: request.id, timestamp: new Date().toISOString() },
        });
        return;
      }
    } catch (_err) {
      await reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to verify admin access' },
        meta: { request_id: request.id, timestamp: new Date().toISOString() },
      });
      return;
    }
  };
}
