/**
 * Drizzle Kit Configuration
 *
 * CONFORM Plan_de_implementare F2.1.2:
 * - Dialect: PostgreSQL
 * - Migrații SQL ca sursă de adevăr
 * - Nu folosim migrații auto-aplicate în runtime
 *
 * Comenzi:
 * - pnpm db:generate - Generează migrații din schema changes
 * - pnpm db:migrate - Aplică migrații pe database
 * - pnpm db:studio - Deschide Drizzle Studio GUI
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // Schema TypeScript files
  schema: './src/schema/index.ts',

  // Output directory pentru migrații SQL generate
  out: './drizzle/migrations',

  // PostgreSQL dialect
  dialect: 'postgresql',

  // Database connection - folosește DATABASE_URL_MIGRATE pentru migrații
  // (rol app_migrator cu privilegii DDL)
  dbCredentials: {
    url: process.env['DATABASE_URL_MIGRATE'] ?? process.env['DATABASE_URL'] ?? '',
  },

  // Verbose output pentru debugging
  verbose: true,

  // Strict mode - nu permite schema drift
  strict: true,

  // Breakpoints în migrații (pentru IDE stepping)
  breakpoints: true,

  // Naming conventions
  casing: 'snake_case',
});
