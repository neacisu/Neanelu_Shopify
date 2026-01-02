/**
 * OAuth State Management
 *
 * CONFORM: Plan_de_implementare F3.2.2, Database_Schema_Complete.md
 * - Generare state criptografic securizat
 * - Stocare în DB cu TTL
 * - Verificare și consum atomic
 */

import { randomBytes } from 'node:crypto';

/**
 * Generează un state token securizat (32 bytes hex = 64 caractere)
 * Folosit pentru CSRF protection în OAuth flow
 */
export function generateSecureState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generează un nonce securizat (16 bytes hex = 32 caractere)
 * Folosit pentru protecție suplimentară replay attack
 */
export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Calculează TTL pentru state (default 10 minute)
 */
export function getStateExpiration(ttlMinutes = 10): Date {
  return new Date(Date.now() + ttlMinutes * 60 * 1000);
}

/**
 * Interfață pentru OAuth state stocat în DB
 */
export interface OAuthStateRecord {
  id: string;
  state: string;
  shopDomain: string;
  redirectUri: string;
  nonce: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

/**
 * Verifică dacă un state record este valid pentru consum
 */
export function isStateValid(record: OAuthStateRecord | null): boolean {
  if (!record) return false;
  if (record.usedAt !== null) return false; // Already used
  if (record.expiresAt < new Date()) return false; // Expired
  return true;
}
