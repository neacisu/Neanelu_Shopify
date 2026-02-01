import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '@app/database';
import type { SessionData } from './session.js';

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
      const result = await pool.query<{ role: { admin?: boolean } }>(
        `SELECT role FROM staff_users WHERE shop_id = $1`,
        [session.shopId]
      );
      const hasAdmin = result.rows.some((row) => row.role?.admin === true);
      if (!hasAdmin) {
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
