/**
 * Interfață comună pentru clientul PostgreSQL în pipeline-ul lexical (PoolClient / withTenantContext).
 */
export interface TenantClient {
  query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ) => Promise<{ rows: TRow[]; rowCount: number }>;
}
