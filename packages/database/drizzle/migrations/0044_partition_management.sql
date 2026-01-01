-- Migration: 0044_partition_management.sql
-- Epic 6: Partition management functions

-- ============================================
-- Function 1: Create Future Partitions
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
  -- Loop through months
  FOR i IN 0..months_ahead LOOP
    v_date := date_trunc('month', current_date + (i || ' months')::interval)::date;
    v_start_date := v_date;
    v_end_date := (v_date + interval '1 month')::date;
    
    -- Loop through partitioned tables
    FOREACH v_table IN ARRAY v_tables LOOP
      v_partition_name := v_table || '_' || to_char(v_date, 'YYYYMM');
      
      -- Check if partition exists
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = v_partition_name
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
-- Function 2: Drop Old Partitions
-- ============================================

CREATE OR REPLACE FUNCTION drop_old_partitions(
  retention_days int DEFAULT 90
)
RETURNS TABLE (
  partition_name text,
  parent_table text,
  status text
) AS $$
DECLARE
  v_partition record;
  v_cutoff text;
  v_partition_date text;
BEGIN
  v_cutoff := to_char(current_date - (retention_days || ' days')::interval, 'YYYYMM');
  
  FOR v_partition IN 
    SELECT c.relname as partition_name, 
           p.relname as parent_name
    FROM pg_class c
    JOIN pg_inherits i ON c.oid = i.inhrelid
    JOIN pg_class p ON i.inhparent = p.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.relname IN ('webhook_events', 'api_cost_tracking')
      AND c.relname ~ '_[0-9]{6}$'
  LOOP
    -- Extract YYYYMM from partition name
    v_partition_date := substring(v_partition.partition_name from '_([0-9]{6})$');
    
    IF v_partition_date IS NOT NULL AND v_partition_date < v_cutoff THEN
      BEGIN
        EXECUTE format('DROP TABLE IF EXISTS %I', v_partition.partition_name);
        RETURN QUERY SELECT v_partition.partition_name, v_partition.parent_name, 'dropped'::text;
      EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT v_partition.partition_name, v_partition.parent_name, ('error: ' || SQLERRM)::text;
      END;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION drop_old_partitions IS 'Drop partitions older than retention_days. Call monthly. Default: 90 days for webhook_events, api_cost_tracking.';

-- ============================================
-- Function 3: Get Partition Statistics
-- ============================================

CREATE OR REPLACE FUNCTION get_partition_stats()
RETURNS TABLE (
  parent_table text,
  partition_name text,
  partition_range text,
  row_count bigint,
  size_bytes bigint,
  size_pretty text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.relname::text as parent_table,
    c.relname::text as partition_name,
    pg_get_expr(c.relpartbound, c.oid)::text as partition_range,
    (SELECT reltuples::bigint FROM pg_class WHERE oid = c.oid) as row_count,
    pg_relation_size(c.oid) as size_bytes,
    pg_size_pretty(pg_relation_size(c.oid)) as size_pretty
  FROM pg_class c
  JOIN pg_inherits i ON c.oid = i.inhrelid
  JOIN pg_class p ON i.inhparent = p.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.relkind = 'p'
  ORDER BY p.relname, c.relname;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_partition_stats IS 'Get statistics for all partitions: row count, size.';

-- ============================================
-- Execute: Create Upcoming Partitions
-- ============================================

-- Create partitions for next 3 months immediately
SELECT * FROM create_future_partitions(3);
