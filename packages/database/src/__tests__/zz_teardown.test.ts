import { describe, it } from 'node:test';
import { closePool } from './helpers/test-utils.ts';

void describe('Global Teardown', () => {
  void it('closes the database connection pool to allow process exit', async () => {
    await closePool();
    console.info('✅ Database pool closed successfully.');
  });
});
