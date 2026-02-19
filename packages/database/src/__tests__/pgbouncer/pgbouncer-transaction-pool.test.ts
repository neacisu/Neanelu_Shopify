import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GenericContainer, Network, Wait, type StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

void test('PgBouncer uses transaction pool_mode (smoke)', async () => {
  const network = await new Network().start();

  const username = 'app';
  const password = 'secret_pw_for_test';
  const database = 'testdb';

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neanelu-pgbouncer-'));
  // mkdtemp defaults to 0700; the pgbouncer image does not necessarily run as root.
  await fs.chmod(tmpDir, 0o755);

  let pgContainer: StartedPostgreSqlContainer | undefined;
  let pgbouncer: StartedTestContainer | undefined;
  let clientAdmin: pg.Client | undefined;
  let clientApp: pg.Client | undefined;

  try {
    // Minimal Postgres for PgBouncer to connect to.
    pgContainer = await new PostgreSqlContainer('postgres:18-alpine')
      .withNetwork(network)
      .withNetworkAliases('db')
      .withDatabase(database)
      .withUsername(username)
      .withPassword(password)
      .start();

    const ini = `
[databases]
${database} = host=db port=5432 dbname=${database}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = plain
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 200
default_pool_size = 20
ignore_startup_parameters = extra_float_digits
admin_users = ${username}
stats_users = ${username}
`;

    // Use plain auth inside test to avoid Postgres SCRAM/MD5 differences.
    const userlist = `"${username}" "${password}"\n`;
    await fs.writeFile(path.join(tmpDir, 'pgbouncer.ini'), ini.trim() + '\n', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'userlist.txt'), userlist, 'utf-8');

    // Bring up PgBouncer with our mounted config.
    pgbouncer = await new GenericContainer('edoburu/pgbouncer:latest')
      .withNetwork(network)
      .withBindMounts([{ source: tmpDir, target: '/etc/pgbouncer', mode: 'ro' }])
      // IMPORTANT: override image entrypoint to avoid its startup script trying to write into /etc/pgbouncer/
      .withEntrypoint(['/usr/bin/pgbouncer'])
      .withCommand(['/etc/pgbouncer/pgbouncer.ini'])
      .withExposedPorts(6432)
      .withWaitStrategy(Wait.forLogMessage(/listening on/i))
      .start();

    const host = pgbouncer.getHost();
    const port = pgbouncer.getMappedPort(6432);

    clientAdmin = new pg.Client({
      host,
      port,
      user: username,
      password,
      // PgBouncer admin console lives in the special "pgbouncer" database.
      database: 'pgbouncer',
    });
    await clientAdmin.connect();

    const cfg = await clientAdmin.query('SHOW CONFIG;');
    const row = (cfg.rows as { key: string; value: string }[]).find((r) => r.key === 'pool_mode');
    assert.ok(row, 'pool_mode should exist in SHOW CONFIG');
    assert.equal(row.value, 'transaction');

    // Also ensure SHOW POOLS works (useful for diagnostics).
    const pools = await clientAdmin.query('SHOW POOLS;');
    assert.ok((pools.rowCount ?? 0) >= 0);

    // Smoke: app DB is reachable through PgBouncer (query goes to Postgres).
    clientApp = new pg.Client({
      host,
      port,
      user: username,
      password,
      database,
    });
    await clientApp.connect();
    const r = await clientApp.query('SELECT 1 as ok');
    assert.equal(r.rows[0]?.ok, 1);
  } finally {
    await clientApp?.end().catch(() => undefined);
    await clientAdmin?.end().catch(() => undefined);
    await pgbouncer?.stop().catch(() => undefined);
    await pgContainer?.stop().catch(() => undefined);
    await network.stop().catch(() => undefined);
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
});
