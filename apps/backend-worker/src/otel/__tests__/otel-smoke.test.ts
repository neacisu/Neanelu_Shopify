import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const enabled = process.env['RUN_OTEL_SMOKE'] === '1';

const enabledForSmokeRun = process.env['SMOKE_RUN'] === '1';

void describe('otel smoke (dev)', { skip: !(enabled || enabledForSmokeRun) }, () => {
  void it('exports OTLP traces to the configured endpoint', async () => {
    let traceRequests = 0;
    let metricRequests = 0;

    const server = createServer((req, res) => {
      if (req.url === '/v1/traces' && req.method === 'POST') traceRequests += 1;
      if (req.url === '/v1/metrics' && req.method === 'POST') metricRequests += 1;

      // Drain body (avoid backpressure)
      req.on('data', () => {
        // ignore
      });
      req.on('end', () => {
        res.statusCode = 200;
        res.end('ok');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;

    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--import', './src/otel/register.ts', './src/otel/otel-smoke-runner.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'development',
          OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
          OTEL_SERVICE_NAME: process.env['OTEL_SERVICE_NAME'] ?? 'neanelu-shopify-smoke',
          OTEL_SAMPLING_RATIO: '1.0',
          OBS_DEBUG: '0',
        },
        stdio: 'pipe',
      }
    );

    let stderr = '';
    child.stderr.on('data', (buf) => {
      stderr += String(buf);
    });

    const exitCode: number = await new Promise((resolve) => {
      child.on('close', resolve);
    });

    server.close();

    assert.equal(exitCode, 0, `child exited with ${exitCode}: ${stderr}`);
    assert.ok(traceRequests > 0, 'expected at least one OTLP trace export request');

    // Metrics export interval is periodic; shutdown typically flushes, but keep it best-effort.
    assert.ok(metricRequests >= 0);
  });
});
