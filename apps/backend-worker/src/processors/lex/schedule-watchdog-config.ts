/**
 * Env parsing for `runLexShardWatchdogTick` (no imports that trigger loadEnv / queue init).
 */
export function parseLexWatchdogShopBatchSize(): number {
  const raw = process.env['LEX_WATCHDOG_SHOP_BATCH'] ?? '200';
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 200;
  return Math.min(2000, n);
}
