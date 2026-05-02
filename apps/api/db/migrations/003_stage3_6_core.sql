-- 003_stage3_6_core.sql
-- Stage 3-6 base tables for Supabase provider parity

CREATE TABLE IF NOT EXISTS daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_date DATE NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('pickup', 'dropoff')),
  rides_count INTEGER NOT NULL DEFAULT 0,
  registered_passengers INTEGER NOT NULL DEFAULT 0,
  issues_count INTEGER NOT NULL DEFAULT 0,
  affected_passengers INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(service_date, service_type)
);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_date DATE NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('pickup', 'dropoff')),
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  shift_time TEXT NOT NULL,
  passengers_count INTEGER NOT NULL DEFAULT 0,
  issue_type TEXT NOT NULL,
  description TEXT NOT NULL,
  delay_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kpi_thresholds (
  metric_key TEXT PRIMARY KEY,
  green_min NUMERIC(12,4) NOT NULL,
  green_max NUMERIC(12,4) NOT NULL,
  yellow_min NUMERIC(12,4) NOT NULL,
  yellow_max NUMERIC(12,4) NOT NULL,
  red_min NUMERIC(12,4) NOT NULL,
  red_max NUMERIC(12,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE day_types
  ADD COLUMN IF NOT EXISTS no_activity BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE targets_history
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_daily_metrics_service_date ON daily_metrics(service_date);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_service_type ON daily_metrics(service_type);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_service_date_type ON daily_metrics(service_date, service_type);

CREATE INDEX IF NOT EXISTS idx_incidents_service_date ON incidents(service_date);
CREATE INDEX IF NOT EXISTS idx_incidents_service_type ON incidents(service_type);
CREATE INDEX IF NOT EXISTS idx_incidents_service_date_type ON incidents(service_date, service_type);

CREATE INDEX IF NOT EXISTS idx_day_types_service_date ON day_types(service_date);
CREATE INDEX IF NOT EXISTS idx_targets_history_metric_scope_effective ON targets_history(metric_key, scope_key, effective_from DESC);
