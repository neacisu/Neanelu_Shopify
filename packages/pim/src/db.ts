import type pg from 'pg';

import { createSecondaryPool, type SecondaryPoolHandle } from '@app/database';

let _pimPoolHandle: SecondaryPoolHandle | null = null;

function getOrCreatePimPoolHandle(): SecondaryPoolHandle {
  if (_pimPoolHandle) return _pimPoolHandle;

  const runtimeConnectionString = process.env['DATABASE_URL'];
  _pimPoolHandle = createSecondaryPool({
    name: 'pim',
    maxConnections: Number(process.env['DB_POOL_SIZE'] ?? 2),
    ...(runtimeConnectionString ? { connectionString: runtimeConnectionString } : {}),
  });
  return _pimPoolHandle;
}

export function getDbPool(): pg.Pool {
  return getOrCreatePimPoolHandle().pool;
}

export async function rotatePimPool(newConnectionString: string): Promise<void> {
  await getOrCreatePimPoolHandle().rotate(newConnectionString);
}

export function getCurrentPimConnectionString(): string | undefined {
  return getOrCreatePimPoolHandle().getCurrentConnectionString();
}

export async function closePimPool(): Promise<void> {
  if (!_pimPoolHandle) return;
  await _pimPoolHandle.close();
  _pimPoolHandle = null;
}
