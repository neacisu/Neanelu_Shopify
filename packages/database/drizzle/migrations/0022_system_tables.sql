-- Migration: 0022_system_tables.sql
-- Purpose: Add missing system tables from Database_Schema_Complete.md
-- Tables: key_rotations, feature_flags, system_config, migration_history

-- ============================================
-- Table: key_rotations
-- Purpose: Audit trail for encryption key rotation (F2.2.3.2)
-- ============================================
CREATE TABLE IF NOT EXISTS key_rotations (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  key_version_old INTEGER NOT NULL,
  key_version_new INTEGER NOT NULL,
  initiated_by UUID REFERENCES staff_users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  records_updated INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  
  CONSTRAINT chk_key_rotation_status CHECK (status IN ('in_progress', 'completed', 'failed'))
);

CREATE INDEX idx_key_rotations_status ON key_rotations(status) 
  WHERE status = 'in_progress';

-- ============================================
-- Table: feature_flags
-- Purpose: Per-shop feature flag configurations (F7.0)
-- ============================================
CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  flag_key VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  default_value BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  rollout_percentage INTEGER DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  allowed_shop_ids UUID[] DEFAULT '{}',
  blocked_shop_ids UUID[] DEFAULT '{}',
  conditions JSONB DEFAULT '{}',
  created_by UUID REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_feature_flags_active ON feature_flags(is_active) 
  WHERE is_active = true;

-- Trigger for updated_at
CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Table: system_config
-- Purpose: Persistent system-wide configuration (F0.1)
-- ============================================
CREATE TABLE IF NOT EXISTS system_config (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  is_sensitive BOOLEAN DEFAULT false,
  updated_by UUID REFERENCES staff_users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Table: migration_history
-- Purpose: Track DB migrations for zero-downtime deploys (F7.3)
-- ============================================
CREATE TABLE IF NOT EXISTS migration_history (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  migration_name VARCHAR(255) UNIQUE NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT now(),
  applied_by VARCHAR(100) DEFAULT current_user,
  execution_time_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT
);

CREATE INDEX idx_migration_history_applied ON migration_history(applied_at DESC);
