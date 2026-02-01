#!/usr/bin/env node
/**
 * Vector Search Load Test
 *
 * SLA Targets:
 * - Cached queries: p95 < 100ms
 * - Uncached queries: p95 < 300ms
 */

import { parseArgs } from 'node:util';

interface LoadTestConfig {
  baseUrl: string;
  concurrency: number;
  durationSeconds: number;
  authCookie: string;
  warmupRequests: number;
}

interface RequestResult {
  latencyMs: number;
  cached: boolean;
  success: boolean;
  statusCode: number;
  error?: string;
}

interface LoadTestReport {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  cachedCount: number;
  uncachedCount: number;
  latencyAllP50: number;
  latencyAllP95: number;
  latencyAllP99: number;
  latencyCachedP95: number;
  latencyUncachedP95: number;
  slaPass: boolean;
  slaCachedPass: boolean;
  slaUncachedPass: boolean;
  durationSeconds: number;
  requestsPerSecond: number;
}

const SAMPLE_QUERIES = [
  'apa minerala naturala',
  'suc de portocale bio',
  'cafea arabica 100%',
  'ciocolata neagra 70%',
  'ulei de masline extravirgin',
  'paste integrale',
  'orez basmati',
  'vin rosu sec',
  'bere artizanala IPA',
  'iaurt grecesc',
];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function makeSearchRequest(
  baseUrl: string,
  query: string,
  authCookie: string
): Promise<RequestResult> {
  const start = process.hrtime.bigint();

  try {
    const url = `${baseUrl}/api/products/search?q=${encodeURIComponent(query)}&limit=20`;
    const res = await fetch(url, {
      headers: authCookie ? { Cookie: authCookie } : undefined,
    });

    const end = process.hrtime.bigint();
    const latencyMs = Number(end - start) / 1_000_000;

    if (!res.ok) {
      return { latencyMs, cached: false, success: false, statusCode: res.status };
    }

    const json = (await res.json()) as { data?: { cached?: boolean } };
    const cached = json.data?.cached === true;

    return { latencyMs, cached, success: true, statusCode: res.status };
  } catch (error) {
    const end = process.hrtime.bigint();
    const latencyMs = Number(end - start) / 1_000_000;
    return {
      latencyMs,
      cached: false,
      success: false,
      statusCode: 0,
      error: String(error),
    };
  }
}

async function runLoadTest(config: LoadTestConfig): Promise<LoadTestReport> {
  const results: RequestResult[] = [];
  const startTime = Date.now();
  const endTime = startTime + config.durationSeconds * 1000;

  console.info(
    `Starting load test: ${config.concurrency} concurrent, ${config.durationSeconds}s duration`
  );
  console.info(`Target: ${config.baseUrl}`);

  console.info(`Warmup: ${config.warmupRequests} requests...`);
  for (let i = 0; i < config.warmupRequests; i += 1) {
    const query = SAMPLE_QUERIES[i % SAMPLE_QUERIES.length]!;
    await makeSearchRequest(config.baseUrl, query, config.authCookie);
  }

  console.info('Running load test...');
  let requestCount = 0;

  while (Date.now() < endTime) {
    const batch = Array.from({ length: config.concurrency }, (_, i) => {
      const query = SAMPLE_QUERIES[(requestCount + i) % SAMPLE_QUERIES.length]!;
      return makeSearchRequest(config.baseUrl, query, config.authCookie);
    });

    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
    requestCount += config.concurrency;

    const elapsed = (Date.now() - startTime) / 1000;
    process.stdout.write(`\rRequests: ${results.length}, Elapsed: ${elapsed.toFixed(1)}s`);
  }

  console.info('\n\nAnalyzing results...');

  const successResults = results.filter((r) => r.success);
  const cachedResults = successResults.filter((r) => r.cached);
  const uncachedResults = successResults.filter((r) => !r.cached);

  const allLatencies = successResults.map((r) => r.latencyMs);
  const cachedLatencies = cachedResults.map((r) => r.latencyMs);
  const uncachedLatencies = uncachedResults.map((r) => r.latencyMs);

  const actualDuration = (Date.now() - startTime) / 1000;

  const report: LoadTestReport = {
    totalRequests: results.length,
    successCount: successResults.length,
    errorCount: results.length - successResults.length,
    cachedCount: cachedResults.length,
    uncachedCount: uncachedResults.length,
    latencyAllP50: percentile(allLatencies, 50),
    latencyAllP95: percentile(allLatencies, 95),
    latencyAllP99: percentile(allLatencies, 99),
    latencyCachedP95: percentile(cachedLatencies, 95),
    latencyUncachedP95: percentile(uncachedLatencies, 95),
    slaCachedPass: percentile(cachedLatencies, 95) < 100,
    slaUncachedPass: percentile(uncachedLatencies, 95) < 300,
    slaPass: false,
    durationSeconds: actualDuration,
    requestsPerSecond: results.length / actualDuration,
  };

  report.slaPass = report.slaCachedPass && report.slaUncachedPass;

  return report;
}

function printReport(report: LoadTestReport): void {
  console.info('\n========================================');
  console.info('       VECTOR SEARCH LOAD TEST REPORT');
  console.info('========================================\n');

  console.info(`Duration: ${report.durationSeconds.toFixed(1)}s`);
  console.info(`Total Requests: ${report.totalRequests}`);
  console.info(`Success: ${report.successCount} | Errors: ${report.errorCount}`);
  console.info(`Throughput: ${report.requestsPerSecond.toFixed(1)} req/s`);
  console.info(`Cached: ${report.cachedCount} | Uncached: ${report.uncachedCount}`);

  console.info('\nLatency (all requests):');
  console.info(`  p50: ${report.latencyAllP50.toFixed(1)}ms`);
  console.info(`  p95: ${report.latencyAllP95.toFixed(1)}ms`);
  console.info(`  p99: ${report.latencyAllP99.toFixed(1)}ms`);

  console.info('\nSLA Validation:');
  console.info(
    `  Cached p95 < 100ms: ${report.latencyCachedP95.toFixed(1)}ms ${
      report.slaCachedPass ? 'PASS' : 'FAIL'
    }`
  );
  console.info(
    `  Uncached p95 < 300ms: ${report.latencyUncachedP95.toFixed(1)}ms ${
      report.slaUncachedPass ? 'PASS' : 'FAIL'
    }`
  );

  console.info('\n========================================');
  console.info(`OVERALL: ${report.slaPass ? 'SLA PASS' : 'SLA FAIL'}`);
  console.info('========================================\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      baseUrl: { type: 'string', default: 'http://localhost:65001' },
      concurrency: { type: 'string', default: '10' },
      duration: { type: 'string', default: '60' },
      authCookie: { type: 'string', default: '' },
      warmup: { type: 'string', default: '20' },
    },
  });

  const config: LoadTestConfig = {
    baseUrl: values.baseUrl ?? 'http://localhost:65001',
    concurrency: Number(values.concurrency ?? 10),
    durationSeconds: Number(values.duration ?? 60),
    authCookie: values.authCookie ?? '',
    warmupRequests: Number(values.warmup ?? 20),
  };

  const report = await runLoadTest(config);
  printReport(report);
  process.exit(report.slaPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
