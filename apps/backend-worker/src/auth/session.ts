/**
 * Session Management for Admin UI
 *
 * CONFORM: Plan_de_implementare F3.2.3
 * - Sesiune minimală pentru admin dashboard
 * - Bazat pe cookie securizat
 */

import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { pool } from '@app/database';

/**
 * Configurare sesiune
 */
export interface SessionConfig {
  secret: string;
  /** Optional: validate Shopify session token (JWT) audience (aud) against SHOPIFY_API_KEY */
  shopifyApiKey?: string;
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

type ShopifySessionTokenHeader = Readonly<{
  alg?: string;
  typ?: string;
}>;

type ShopifySessionTokenPayload = Readonly<{
  iss?: string;
  dest?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
}>;

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function safeTimingEqual(a: string, b: string): boolean {
  // Prevent timing side-channels while still handling length mismatch.
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function resolveShopDomainFromShopifyJwt(payload: ShopifySessionTokenPayload): string | null {
  const candidate = payload.dest ?? payload.iss;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.hostname;
  } catch {
    // Some tokens use iss like https://{shop}/admin
    if (typeof candidate === 'string' && candidate.startsWith('https://')) {
      try {
        const url = new URL(candidate.replace(/\/?admin\/?$/, ''));
        return url.hostname;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function isAudienceValid(aud: ShopifySessionTokenPayload['aud'], apiKey: string): boolean {
  if (typeof aud === 'string') return aud === apiKey;
  if (Array.isArray(aud)) return aud.includes(apiKey);
  return false;
}

/**
 * Verifies a Shopify App Bridge session token (JWT) signed with HS256 (SHOPIFY_API_SECRET).
 * Returns minimal session data for request scoping.
 */
export function verifyShopifySessionToken(
  token: string,
  config: Pick<SessionConfig, 'secret' | 'shopifyApiKey'>
): SessionData | null {
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) return null;

    const headerJson = Buffer.from(encodedHeader, 'base64url').toString('utf-8');
    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf-8');

    const header = safeJsonParse<ShopifySessionTokenHeader>(headerJson);
    const payload = safeJsonParse<ShopifySessionTokenPayload>(payloadJson);
    if (!header || !payload) return null;

    if (header.alg !== 'HS256') return null;

    if (config.shopifyApiKey && !isAudienceValid(payload.aud, config.shopifyApiKey)) {
      return null;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.nbf === 'number' && nowSec < payload.nbf) return null;
    if (typeof payload.exp === 'number' && nowSec >= payload.exp) return null;

    const expectedSignature = createHmac('sha256', config.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    if (!safeTimingEqual(encodedSignature, expectedSignature)) return null;

    const shopDomain = resolveShopDomainFromShopifyJwt(payload);
    if (!shopDomain) return null;

    // NOTE: A Shopify session token does not include the DB shop id.
    // For endpoints that require a DB-backed shopId, resolve it after auth.
    return {
      shopId: shopDomain,
      shopDomain,
      createdAt: Date.now(),
    };
  } catch {
    return null;
  }
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
 * Get session from Authorization header (Bearer <token>)
 */
export function getSessionFromAuthorizationHeader(
  request: FastifyRequest,
  config: SessionConfig
): SessionData | null {
  const auth = request.headers.authorization;
  if (typeof auth !== 'string') return null;

  const [scheme, token] = auth.split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  return resolveSessionFromToken(token, config);
}

function getSessionFromQueryParam(
  request: FastifyRequest,
  config: SessionConfig
): SessionData | null {
  const query = request.query as { token?: unknown } | undefined;
  const token = query?.token;
  if (typeof token !== 'string' || !token.length) return null;
  return resolveSessionFromToken(token, config);
}

function resolveSessionFromToken(token: string, config: SessionConfig): SessionData | null {
  const session = token.split('.').length === 3 ? verifyShopifySessionToken(token, config) : null;
  const fallback = session ?? verifySessionToken(token, config.secret);
  if (!fallback) return null;

  const age = (Date.now() - fallback.createdAt) / 1000;
  if (age > config.maxAge) return null;

  return fallback;
}

export function getSessionFromRequest(
  request: FastifyRequest,
  config: SessionConfig
): SessionData | null {
  return (
    getSessionFromAuthorizationHeader(request, config) ??
    getSessionFromQueryParam(request, config) ??
    getSession(request, config)
  );
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
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function looksLikeUuid(value: string): boolean {
    return UUID_RE.test(value);
  }

  function normalizeShopDomain(value: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Accept plain hostname, or full URL (dest/iss can be URL-ish).
    try {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const u = new URL(trimmed);
        return u.hostname.toLowerCase();
      }
    } catch {
      // ignore
    }
    // Strip path if present (e.g. "admin.shopify.com/store/xyz" or "shop.myshopify.com/admin").
    const hostOnly = trimmed.split('/')[0] ?? '';
    return hostOnly.trim().toLowerCase() || null;
  }

  async function resolveDbShopIdFromRequest(session: SessionData, request: FastifyRequest) {
    if (looksLikeUuid(session.shopId)) return session.shopId;

    const q = request.query as { shop?: unknown } | undefined;
    const queryShop = typeof q?.shop === 'string' ? normalizeShopDomain(q.shop) : null;
    const tokenShop =
      normalizeShopDomain(session.shopDomain) ?? normalizeShopDomain(session.shopId);

    const shopDomain = queryShop ?? tokenShop;
    if (!shopDomain) return null;

    const result = await pool.query<{ id: string }>(
      `SELECT id FROM shops WHERE shopify_domain = $1 LIMIT 1`,
      [shopDomain]
    );
    return result.rows[0]?.id ?? null;
  }

  function sendUnauthorized(request: FastifyRequest, reply: FastifyReply): void {
    void reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Session required',
      },
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  }

  return (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void => {
    void (async () => {
      const session = getSessionFromRequest(request, config);
      if (!session) {
        sendUnauthorized(request, reply);
        return;
      }

      const isBudgetStatus =
        typeof request.url === 'string' &&
        request.url.includes('/pim/stats/cost-tracking/budget-status');
      if (isBudgetStatus) {
        const q = request.query as { shop?: unknown } | undefined;
        const rawShop = typeof q?.shop === 'string' ? q.shop : null;
        const hasAuth = typeof request.headers.authorization === 'string';
        // Avoid logging any token; we only log presence + basic session fields.
        (request.log as unknown as { info?: (obj: unknown, msg?: string) => void })?.info?.(
          {
            kind: 'requireSession_debug_before',
            url: request.url,
            hasAuth,
            queryShop: rawShop,
            sessionShopId: session.shopId,
            sessionShopDomain: session.shopDomain,
            shopIdLooksUuid: looksLikeUuid(session.shopId),
          },
          'requireSession debug'
        );
      }

      // If the session comes from Shopify App Bridge JWT, `shopId` is not a DB UUID.
      // Resolve DB shop id once, so all DB-backed endpoints can safely use `session.shopId`.
      const resolved = await resolveDbShopIdFromRequest(session, request);
      if (!resolved) {
        sendUnauthorized(request, reply);
        return;
      }
      session.shopId = resolved;

      if (isBudgetStatus) {
        (request.log as unknown as { info?: (obj: unknown, msg?: string) => void })?.info?.(
          {
            kind: 'requireSession_debug_after',
            url: request.url,
            resolvedShopId: session.shopId,
          },
          'requireSession debug'
        );
      }

      // Atașează sesiunea la request pentru utilizare ulterioară
      (request as FastifyRequest & { session: SessionData }).session = session;
    })()
      .catch((error: unknown) => {
        // Be conservative: treat resolver failures as unauthorized from the caller POV.
        (request.log as unknown as { error?: (obj: unknown, msg?: string) => void })?.error?.(
          { error },
          'requireSession failed'
        );
        sendUnauthorized(request, reply);
      })
      .finally(() => {
        done();
      });
  };
}

/**
 * Configurație default pentru sesiune
 */
export function getDefaultSessionConfig(secret: string, shopifyApiKey?: string): SessionConfig {
  const base: Omit<SessionConfig, 'shopifyApiKey'> = {
    secret,
    cookieName: 'neanelu_session',
    maxAge: 24 * 60 * 60, // 24 ore
  };

  return shopifyApiKey ? { ...base, shopifyApiKey } : base;
}
