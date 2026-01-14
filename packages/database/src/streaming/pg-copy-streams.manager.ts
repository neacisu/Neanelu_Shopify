import type { PoolClient } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import type { Writable } from 'node:stream';

import { pool, setTenantContext } from '../db.js';

export type CopyCommand = Readonly<{
  sql: string;
}>;

export type PgCopyResult = Readonly<{
  rowsWritten: number | null;
}>;

export class PgCopyStreamsManager {
  public async withCopyFrom<T>(params: {
    shopId: string;
    command: CopyCommand;
    /**
     * Called with a Writable COPY stream. Must write and end the stream.
     * If it throws, the transaction is rolled back.
     */
    write: (stream: Writable) => Promise<T>;
  }): Promise<Readonly<{ value: T; copy: PgCopyResult }>> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await setTenantContext(client, params.shopId);

      const copyStream = client.query(copyFrom(params.command.sql));

      const value = await params.write(copyStream);

      const rowsWritten = await new Promise<number | null>((resolve, reject) => {
        copyStream.on('error', reject);
        copyStream.on('finish', () => {
          // pg-copy-streams does not expose rowcount reliably for COPY FROM STDIN.
          resolve(null);
        });
      });

      await client.query('COMMIT');
      return { value, copy: { rowsWritten } };
    } catch (err) {
      await safeRollback(client);
      throw err;
    } finally {
      client.release();
    }
  }
}

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // ignore
  }
}
