/**
 * Schema Query Helpers for Database Tests
 *
 * Provides typed queries for information_schema and pg_catalog
 * to verify database structure, constraints, indexes, and policies.
 */

import { query, queryOne } from './test-utils.ts';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface TableInfo {
  table_name: string;
  table_type: string;
  [key: string]: unknown;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  ordinal_position: number;
  [key: string]: unknown;
}

export interface IndexInfo {
  indexname: string;
  tablename: string;
  indexdef: string;
  [key: string]: unknown;
}

export interface ConstraintInfo {
  constraint_name: string;
  constraint_type: string;
  table_name: string;
  [key: string]: unknown;
}

export interface ForeignKeyInfo {
  constraint_name: string;
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
  delete_rule: string;
  update_rule: string;
  [key: string]: unknown;
}

export interface CheckConstraintInfo {
  constraint_name: string;
  table_name: string;
  check_clause: string;
  [key: string]: unknown;
}

export interface RlsInfo {
  tablename: string;
  rowsecurity: boolean;
  [key: string]: unknown;
}

export interface PolicyInfo {
  tablename: string;
  policyname: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
  [key: string]: unknown;
}

export interface TriggerInfo {
  trigger_name: string;
  event_manipulation: string;
  event_object_table: string;
  action_statement: string;
  action_timing: string;
  [key: string]: unknown;
}

export interface FunctionInfo {
  routine_name: string;
  routine_type: string;
  data_type: string | null;
  type_udt_name: string | null;
  [key: string]: unknown;
}

export interface PartitionInfo {
  parent_table: string;
  partition_name: string;
  partition_expression: string;
  [key: string]: unknown;
}

export interface ExtensionInfo {
  extname: string;
  extversion: string;
  [key: string]: unknown;
}

export interface MaterializedViewInfo {
  matviewname: string;
  definition: string;
  [key: string]: unknown;
}

// ============================================
// TABLE QUERIES
// ============================================

/**
 * Get all tables in public schema
 */
export async function getAllTables(): Promise<TableInfo[]> {
  return query<TableInfo>(`
    SELECT
      c.relname as table_name,
      'BASE TABLE'::text as table_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relispartition = false
    ORDER BY c.relname
  `);
}

/**
 * Get table info by name
 */
export async function getTableInfo(tableName: string): Promise<TableInfo | null> {
  return queryOne<TableInfo>(
    `
    SELECT
      c.relname as table_name,
      'BASE TABLE'::text as table_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relispartition = false
      AND c.relname = $1
  `,
    [tableName]
  );
}

/**
 * Get all columns for a table
 */
export async function getTableColumns(tableName: string): Promise<ColumnInfo[]> {
  return query<ColumnInfo>(
    `
    SELECT 
      column_name, 
      data_type,
      udt_name,
      is_nullable, 
      column_default,
      character_maximum_length,
      numeric_precision,
      ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = $1
    ORDER BY ordinal_position
  `,
    [tableName]
  );
}

/**
 * Get column info by name
 */
export async function getColumnInfo(
  tableName: string,
  columnName: string
): Promise<ColumnInfo | null> {
  return queryOne<ColumnInfo>(
    `
    SELECT 
      column_name, 
      data_type,
      udt_name,
      is_nullable, 
      column_default,
      character_maximum_length,
      numeric_precision,
      ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = $1
    AND column_name = $2
  `,
    [tableName, columnName]
  );
}

/**
 * Get column count for a table
 */
export async function getColumnCount(tableName: string): Promise<number> {
  const result = await queryOne<{ count: string }>(
    `
    SELECT COUNT(*) as count
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = $1
  `,
    [tableName]
  );
  return parseInt(result?.count ?? '0', 10);
}

// ============================================
// INDEX QUERIES
// ============================================

/**
 * Get all indexes for a table
 */
export async function getTableIndexes(tableName: string): Promise<IndexInfo[]> {
  return query<IndexInfo>(
    `
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = $1
    ORDER BY indexname
  `,
    [tableName]
  );
}

/**
 * Get all indexes in database
 */
export async function getAllIndexes(): Promise<IndexInfo[]> {
  return query<IndexInfo>(`
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `);
}

/**
 * Get index by name
 */
export async function getIndexInfo(indexName: string): Promise<IndexInfo | null> {
  return queryOne<IndexInfo>(
    `
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND indexname = $1
  `,
    [indexName]
  );
}

/**
 * Get indexes by type (btree, gin, hnsw, etc.)
 */
export async function getIndexesByType(indexType: string): Promise<IndexInfo[]> {
  return query<IndexInfo>(
    `
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND indexdef ILIKE $1
    ORDER BY tablename, indexname
  `,
    [`%${indexType}%`]
  );
}

/**
 * Get GIN indexes
 */
export async function getGinIndexes(): Promise<IndexInfo[]> {
  return getIndexesByType('gin');
}

/**
 * Get HNSW indexes (pgvector)
 */
export async function getHnswIndexes(): Promise<IndexInfo[]> {
  return getIndexesByType('hnsw');
}

/**
 * Get unique indexes
 */
export async function getUniqueIndexes(): Promise<IndexInfo[]> {
  return query<IndexInfo>(`
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND indexdef LIKE '%UNIQUE%'
    ORDER BY tablename, indexname
  `);
}

// ============================================
// CONSTRAINT QUERIES
// ============================================

/**
 * Get all constraints for a table
 */
export async function getTableConstraints(tableName: string): Promise<ConstraintInfo[]> {
  return query<ConstraintInfo>(
    `
    SELECT 
      c.conname as constraint_name,
      CASE c.contype
        WHEN 'p' THEN 'PRIMARY KEY'
        WHEN 'u' THEN 'UNIQUE'
        WHEN 'f' THEN 'FOREIGN KEY'
        WHEN 'c' THEN 'CHECK'
        ELSE c.contype::text
      END as constraint_type,
      t.relname as table_name
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
    AND t.relname = $1
    ORDER BY c.conname
  `,
    [tableName]
  );
}

/**
 * Get all foreign keys
 */
export async function getAllForeignKeys(): Promise<ForeignKeyInfo[]> {
  return query<ForeignKeyInfo>(`
    WITH fk_constraints AS (
      SELECT
        c.conname AS constraint_name,
        c.conrelid,
        c.confrelid,
        rel.relname AS table_name,
        frel.relname AS foreign_table_name,
        c.confdeltype,
        c.confupdtype,
        c.conkey,
        c.confkey
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
      JOIN pg_class frel ON frel.oid = c.confrelid
      WHERE c.contype = 'f'
        AND n.nspname = 'public'
        AND rel.relispartition = false
    )
    SELECT
      fk.constraint_name,
      fk.table_name,
      a.attname AS column_name,
      fk.foreign_table_name,
      fa.attname AS foreign_column_name,
      CASE fk.confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        ELSE fk.confdeltype::text
      END AS delete_rule,
      CASE fk.confupdtype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        ELSE fk.confupdtype::text
      END AS update_rule
    FROM fk_constraints fk
    JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY AS conkey(attnum, ord) ON true
    JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY AS confkey(attnum, ord) ON conkey.ord = confkey.ord
    JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = conkey.attnum
    JOIN pg_attribute fa ON fa.attrelid = fk.confrelid AND fa.attnum = confkey.attnum
    ORDER BY fk.table_name, fk.constraint_name, conkey.ord
  `);
}

/**
 * Get foreign keys for a table
 * Uses cached results to avoid repeated expensive queries
 */
let _cachedForeignKeys: ForeignKeyInfo[] | null = null;

export async function getTableForeignKeys(tableName: string): Promise<ForeignKeyInfo[]> {
  // Cache the FK query result to avoid repeated expensive queries
  _cachedForeignKeys ??= await getAllForeignKeys();
  return _cachedForeignKeys.filter((fk) => fk.table_name === tableName);
}

/**
 * Clear the FK cache (call after schema changes or in after() hooks)
 */
export function clearForeignKeyCache(): void {
  _cachedForeignKeys = null;
}

/**
 * Get all CHECK constraints
 */
export async function getAllCheckConstraints(): Promise<CheckConstraintInfo[]> {
  return query<CheckConstraintInfo>(`
    SELECT
      c.conname as constraint_name,
      t.relname as table_name,
      pg_get_constraintdef(c.oid) as check_clause
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE c.contype = 'c'
    AND n.nspname = 'public'
    AND t.relkind IN ('r', 'p')
    AND t.relispartition = false
    ORDER BY t.relname, c.conname
  `);
}

/**
 * Get CHECK constraints for a table
 */
export async function getTableCheckConstraints(tableName: string): Promise<CheckConstraintInfo[]> {
  return query<CheckConstraintInfo>(
    `
    SELECT
      c.conname as constraint_name,
      t.relname as table_name,
      pg_get_constraintdef(c.oid) as check_clause
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE c.contype = 'c'
    AND n.nspname = 'public'
    AND t.relkind IN ('r', 'p')
    AND t.relispartition = false
    AND t.relname = $1
    ORDER BY c.conname
  `,
    [tableName]
  );
}

/**
 * Get all unique constraints
 */
export async function getAllUniqueConstraints(): Promise<ConstraintInfo[]> {
  return query<ConstraintInfo>(`
    SELECT 
      c.conname as constraint_name,
      'UNIQUE' as constraint_type,
      t.relname as table_name
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE c.contype = 'u'
    AND n.nspname = 'public'
    ORDER BY t.relname, c.conname
  `);
}

// ============================================
// RLS QUERIES
// ============================================

/**
 * Get RLS status for all tables
 */
export async function getAllRlsStatus(): Promise<RlsInfo[]> {
  return query<RlsInfo>(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
}

/**
 * Get RLS status for a table
 */
export async function getTableRlsStatus(tableName: string): Promise<boolean> {
  const result = await queryOne<RlsInfo>(
    `
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename = $1
  `,
    [tableName]
  );
  return result?.rowsecurity ?? false;
}

/**
 * Get tables with RLS enabled
 */
export async function getTablesWithRls(): Promise<string[]> {
  const results = await query<RlsInfo>(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
    AND rowsecurity = true
    ORDER BY tablename
  `);
  return results.map((r) => r.tablename);
}

/**
 * Get all RLS policies
 */
export async function getAllPolicies(): Promise<PolicyInfo[]> {
  return query<PolicyInfo>(`
    SELECT tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);
}

/**
 * Get policies for a table
 */
export async function getTablePolicies(tableName: string): Promise<PolicyInfo[]> {
  return query<PolicyInfo>(
    `
    SELECT tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = $1
    ORDER BY policyname
  `,
    [tableName]
  );
}

// ============================================
// TRIGGER QUERIES
// ============================================

/**
 * Get all triggers
 */
export async function getAllTriggers(): Promise<TriggerInfo[]> {
  return query<TriggerInfo>(`
    SELECT 
      trigger_name,
      event_manipulation,
      event_object_table,
      action_statement,
      action_timing
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name
  `);
}

/**
 * Get triggers for a table
 */
export async function getTableTriggers(tableName: string): Promise<TriggerInfo[]> {
  return query<TriggerInfo>(
    `
    SELECT 
      trigger_name,
      event_manipulation,
      event_object_table,
      action_statement,
      action_timing
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    AND event_object_table = $1
    ORDER BY trigger_name
  `,
    [tableName]
  );
}

// ============================================
// FUNCTION QUERIES
// ============================================

/**
 * Get all custom functions (excluding pg_catalog)
 */
export async function getAllFunctions(): Promise<FunctionInfo[]> {
  return query<FunctionInfo>(`
    SELECT 
      routine_name,
      routine_type,
      data_type,
      type_udt_name
    FROM information_schema.routines
    WHERE routine_schema = 'public'
    AND routine_type = 'FUNCTION'
    ORDER BY routine_name
  `);
}

/**
 * Get function info by name
 */
export async function getFunctionInfo(functionName: string): Promise<FunctionInfo | null> {
  return queryOne<FunctionInfo>(
    `
    SELECT 
      routine_name,
      routine_type,
      data_type,
      type_udt_name
    FROM information_schema.routines
    WHERE routine_schema = 'public'
    AND routine_name = $1
  `,
    [functionName]
  );
}

// ============================================
// PARTITION QUERIES
// ============================================

/**
 * Get all partitions
 */
export async function getAllPartitions(): Promise<PartitionInfo[]> {
  return query<PartitionInfo>(`
    SELECT 
      parent.relname as parent_table,
      child.relname as partition_name,
      pg_get_expr(child.relpartbound, child.oid) as partition_expression
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    JOIN pg_namespace n ON parent.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND parent.relkind IN ('p', 'I')
      AND child.relispartition = true
    ORDER BY parent.relname, child.relname
  `);
}

/**
 * Get partitions for a table
 */
export async function getTablePartitions(tableName: string): Promise<PartitionInfo[]> {
  return query<PartitionInfo>(
    `
    SELECT 
      parent.relname as parent_table,
      child.relname as partition_name,
      pg_get_expr(child.relpartbound, child.oid) as partition_expression
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    JOIN pg_namespace n ON parent.relnamespace = n.oid
    WHERE n.nspname = 'public'
    AND parent.relname = $1
    AND parent.relkind = 'p'
    AND child.relispartition = true
    ORDER BY child.relname
  `,
    [tableName]
  );
}

/**
 * Get partitioned tables
 */
export async function getPartitionedTables(): Promise<string[]> {
  const results = await query<{ relname: string }>(`
    SELECT DISTINCT parent.relname
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_namespace n ON parent.relnamespace = n.oid
    WHERE n.nspname = 'public'
    AND parent.relkind = 'p'
    ORDER BY parent.relname
  `);
  return results.map((r) => r.relname);
}

// ============================================
// EXTENSION QUERIES
// ============================================

/**
 * Get all installed extensions
 */
export async function getAllExtensions(): Promise<ExtensionInfo[]> {
  return query<ExtensionInfo>(`
    SELECT extname, extversion
    FROM pg_extension
    ORDER BY extname
  `);
}

/**
 * Check if extension is installed
 */
export async function extensionInstalled(extensionName: string): Promise<boolean> {
  const result = await queryOne<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT FROM pg_extension WHERE extname = $1
    ) as exists
  `,
    [extensionName]
  );
  return result?.exists ?? false;
}

// ============================================
// MATERIALIZED VIEW QUERIES
// ============================================

/**
 * Get all materialized views
 */
export async function getAllMaterializedViews(): Promise<MaterializedViewInfo[]> {
  return query<MaterializedViewInfo>(`
    SELECT matviewname, definition
    FROM pg_matviews
    WHERE schemaname = 'public'
    ORDER BY matviewname
  `);
}

/**
 * Get materialized view indexes
 */
export async function getMaterializedViewIndexes(mvName: string): Promise<IndexInfo[]> {
  return query<IndexInfo>(
    `
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = $1
    ORDER BY indexname
  `,
    [mvName]
  );
}

// ============================================
// VIEW QUERIES
// ============================================

/**
 * Get all regular views
 */
export async function getAllViews(): Promise<{ viewname: string; definition: string }[]> {
  return query<{ viewname: string; definition: string }>(`
    SELECT viewname, definition
    FROM pg_views
    WHERE schemaname = 'public'
    ORDER BY viewname
  `);
}

// ============================================
// STATISTICS
// ============================================

/**
 * Get table statistics
 */
export async function getTableStats(): Promise<{
  tableCount: number;
  totalColumns: number;
  totalIndexes: number;
  totalFks: number;
  totalChecks: number;
  rlsEnabledCount: number;
}> {
  const tables = await getAllTables();
  const indexes = await getAllIndexes();
  const fks = await getAllForeignKeys();
  const checks = await getAllCheckConstraints();
  const rlsTables = await getTablesWithRls();

  let totalColumns = 0;
  for (const table of tables) {
    totalColumns += await getColumnCount(table.table_name);
  }

  return {
    tableCount: tables.length,
    totalColumns,
    totalIndexes: indexes.length,
    totalFks: fks.length,
    totalChecks: checks.length,
    rlsEnabledCount: rlsTables.length,
  };
}
