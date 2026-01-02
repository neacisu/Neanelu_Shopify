/**
 * Auth Module - OAuth Flow Export
 *
 * CONFORM: Plan_de_implementare F3.2
 * Export principal pentru modulul de autentificare Shopify
 */

import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { registerAuthStartRoute } from './routes/auth.start.js';
import { registerAuthCallbackRoute } from './routes/auth.callback.js';

export interface AuthModuleOptions {
  env: AppEnv;
  logger: Logger;
}

/**
 * Înregistrează toate rutele de autentificare
 */
export function registerAuthRoutes(server: FastifyInstance, options: AuthModuleOptions): void {
  registerAuthStartRoute(server, options);
  registerAuthCallbackRoute(server, options);
}

// Re-export utilities pentru uz extern
export { validateShopParam, isValidShopDomain, sanitizeShopDomain } from './validation.js';
export { generateSecureState, generateNonce } from './state.js';
export { verifyShopifyHmac } from './hmac.js';
export {
  checkTokenHealth,
  markNeedsReauth,
  needsReauth,
  clearReauthFlag,
  withTokenRetry,
} from './token-lifecycle.js';
export {
  createSessionToken,
  verifySessionToken,
  setSessionCookie,
  getSession,
  clearSessionCookie,
  requireSession,
  getDefaultSessionConfig,
} from './session.js';
export type { SessionConfig, SessionData } from './session.js';
export {
  processTokenHealthBatch,
  createTokenHealthJobConfig,
  TOKEN_HEALTH_JOB_NAME,
  TOKEN_HEALTH_REPEAT_OPTIONS,
} from './jobs/token-health-job.js';
export type {
  TokenHealthJobConfig,
  TokenHealthJobResult,
  TokenHealthJobData,
} from './jobs/token-health-job.js';
