-- Migration: 0048_partition_management_naming_fix.sql
-- Standardize partition naming to table_YYYY_MM and remediate any previously created table_YYYYMM partitions.

-- ============================================
-- Function 1: Create Future Partitions (YYYY_MM)
-- ============================================

CREATE OR REPLACE FUNCTION create_future_partitions(months_ahead int DEFAULT 3)
RETURNS TABLE (
  partition_name text,
  parent_table text,
  status text
) AS $$
DECLARE
  v_date date;
  v_partition_name text;
  v_start_date date;
  v_end_date date;
  v_tables text[] := ARRAY['webhook_events', 'audit_logs', 'api_cost_tracking', 'inventory_ledger'];
  v_table text;
BEGIN
  FOR i IN 0..months_ahead LOOP
    v_date := date_trunc('month', current_date + (i || ' months')::interval)::date;
    v_start_date := v_date;
    v_end_date := (v_date + interval '1 month')::date;

    FOREACH v_table IN ARRAY v_tables LOOP
      v_partition_name := v_table || '_' || to_char(v_date, 'YYYY_MM');

      IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = v_partition_name
      ) THEN
        BEGIN
          EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            v_partition_name, v_table, v_start_date, v_end_date
          );
          RETURN QUERY SELECT v_partition_name, v_table, 'created'::text;
        EXCEPTION WHEN OTHERS THEN
          RETURN QUERY SELECT v_partition_name, v_table, ('error: ' || SQLERRM)::text;
        END;
      ELSE
        RETURN QUERY SELECT v_partition_name, v_table, 'exists'::text;
      END IF;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_future_partitions IS 'Create partitions for next N months. Call weekly from scheduler.';

-- ============================================
-- Function 2: Drop Old Partitions (supports both YYYYMM + YYYY_MM)
-- ============================================

CREATE OR REPLACE FUNCTION drop_old_partitions(retention_days int DEFAULT 90)
RETURNS TABLE (
  partition_name text,
  parent_table text,
  status text
) AS $$
DECLARE
  v_partition record;
  v_cutoff_date date;
  v_partition_key text;
  v_partition_date date;
BEGIN
  v_cutoff_date := date_trunc('month', (current_date - (retention_days || ' days')::interval))::date;

  FOR v_partition IN
    SELECT c.relname as partition_name,
           p.relname as parent_name
    FROM pg_class c
    JOIN pg_inherits i ON c.oid = i.inhrelid
    JOIN pg_class p ON i.inhparent = p.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.relname IN ('webhook_events', 'api_cost_tracking')
      AND (
        c.relname ~ '_[0-9]{6}$'
        OR c.relname ~ '_[0-9]{4}_[0-9]{2}$'
      )
  LOOP
    -- Extract YYYYMM or YYYY_MM
    v_partition_key := substring(v_partition.partition_name from '_([0-9]{6})$');
    IF v_partition_key IS NULL THEN
      v_partition_key := replace(substring(v_partition.partition_name from '_([0-9]{4}_[0-9]{2})$'), '_', '');
    END IF;

    IF v_partition_key IS NOT NULL THEN
      v_partition_date := to_date(v_partition_key || '01', 'YYYYMMDD');

      IF v_partition_date < v_cutoff_date THEN
        BEGIN
          EXECUTE format('DROP TABLE IF EXISTS %I', v_partition.partition_name);
          RETURN QUERY SELECT v_partition.partition_name, v_partition.parent_name, 'dropped'::text;
        EXCEPTION WHEN OTHERS THEN
          RETURN QUERY SELECT v_partition.partition_name, v_partition.parent_name, ('error: ' || SQLERRM)::text;
        END;
      END IF;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION drop_old_partitions IS 'Drop partitions older than retention_days. Call monthly.';

-- ============================================
-- Remediate: rename misnamed partitions table_YYYYMM -> table_YYYY_MM
-- ============================================

DO $$
DECLARE
  v record;
  v_yyyymm text;
  v_new_name text;
BEGIN
  FOR v IN
    SELECT
      c.relname AS partition_name,
      p.relname AS parent_name
    FROM pg_class c
    JOIN pg_inherits i ON c.oid = i.inhrelid
    JOIN pg_class p ON i.inhparent = p.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.relkind = 'p'
      AND p.relname IN ('webhook_events', 'audit_logs', 'api_cost_tracking', 'inventory_ledger')
      AND c.relname ~ '_[0-9]{6}$'
  LOOP
    v_yyyymm := substring(v.partition_name from '_([0-9]{6})$');
    v_new_name := v.parent_name || '_' || substring(v_yyyymm from 1 for 4) || '_' || substring(v_yyyymm from 5 for 2);

    -- Only rename if the new name doesn't already exist
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = 'public'
        AND c2.relname = v_new_name
    ) THEN
      EXECUTE format('ALTER TABLE %I RENAME TO %I', v.partition_name, v_new_name);
    END IF;
  END LOOP;
END $$;
