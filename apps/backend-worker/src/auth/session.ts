/**
 * Session Management for Admin UI
 *
 * CONFORM: Plan_de_implementare F3.2.3
 * - Sesiune minimală pentru admin dashboard
 * - Bazat pe cookie securizat
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHmac } from 'node:crypto';

/**
 * Configurare sesiune
 */
export interface SessionConfig {
  secret: string;
  cookieName: string;
  maxAge: number; // secunde
}

/**
 * Date sesiune
 */
export interface SessionData {
  shopId: string;
  shopDomain: string;
  createdAt: number;
}

/**
 * Generează un token de sesiune semnat
 */
export function createSessionToken(data: SessionData, secret: string): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

/**
 * Verifică și decodează un token de sesiune
 */
export function verifySessionToken(token: string, secret: string): SessionData | null {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expectedSignature = createHmac('sha256', secret).update(payload).digest('base64url');
    if (signature !== expectedSignature) return null;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as SessionData;

    // Verifică că datele au forma corectă
    if (!data.shopId || !data.shopDomain || !data.createdAt) return null;

    return data;
  } catch {
    return null;
  }
}

/**
 * Setează cookie-ul de sesiune
 */
export function setSessionCookie(
  reply: FastifyReply,
  data: SessionData,
  config: SessionConfig
): void {
  const token = createSessionToken(data, config.secret);

  void reply.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax', // Lax pentru navigare directă, nu embedded
    path: '/',
    maxAge: config.maxAge,
  });
}

/**
 * Obține sesiunea din request
 */
export function getSession(request: FastifyRequest, config: SessionConfig): SessionData | null {
  const token = request.cookies[config.cookieName];
  if (!token) return null;

  const session = verifySessionToken(token, config.secret);
  if (!session) return null;

  // Verifică expirare
  const age = (Date.now() - session.createdAt) / 1000;
  if (age > config.maxAge) return null;

  return session;
}

/**
 * Șterge cookie-ul de sesiune
 */
export function clearSessionCookie(reply: FastifyReply, config: SessionConfig): void {
  void reply.clearCookie(config.cookieName, { path: '/' });
}

/**
 * Middleware pentru verificare sesiune
 */
export function requireSession(config: SessionConfig) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const session = getSession(request, config);
    if (!session) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Session required',
        },
      });
    }
    // Atașează sesiunea la request pentru utilizare ulterioară
    (request as FastifyRequest & { session: SessionData }).session = session;
  };
}

/**
 * Configurație default pentru sesiune
 */
export function getDefaultSessionConfig(secret: string): SessionConfig {
  return {
    secret,
    cookieName: 'neanelu_session',
    maxAge: 24 * 60 * 60, // 24 ore
  };
}
