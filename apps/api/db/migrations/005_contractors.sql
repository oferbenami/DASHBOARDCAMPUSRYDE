-- 005_contractors.sql
-- Add contractors table, per-contractor daily metrics, vehicle type breakdown

CREATE TABLE IF NOT EXISTS contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-contractor daily metrics with vehicle type breakdown
CREATE TABLE IF NOT EXISTS daily_metrics_contractor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_date DATE NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('pickup', 'dropoff')),
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  rides_count INTEGER NOT NULL DEFAULT 0 CHECK (rides_count >= 0),
  taxi_count INTEGER NOT NULL DEFAULT 0 CHECK (taxi_count >= 0),
  large_vehicle_count INTEGER NOT NULL DEFAULT 0 CHECK (large_vehicle_count >= 0),
  registered_passengers INTEGER NOT NULL DEFAULT 0 CHECK (registered_passengers >= 0),
  issues_count INTEGER NOT NULL DEFAULT 0 CHECK (issues_count >= 0),
  affected_passengers INTEGER NOT NULL DEFAULT 0 CHECK (affected_passengers >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(service_date, service_type, contractor_id)
);

-- Add vehicle type fields to aggregate daily_metrics
ALTER TABLE daily_metrics
  ADD COLUMN IF NOT EXISTS taxi_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS large_vehicle_count INTEGER NOT NULL DEFAULT 0;

-- Add contractor reference to incidents
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contractors_active ON contractors(active);
CREATE INDEX IF NOT EXISTS idx_dmc_service_date ON daily_metrics_contractor(service_date);
CREATE INDEX IF NOT EXISTS idx_dmc_contractor ON daily_metrics_contractor(contractor_id);
CREATE INDEX IF NOT EXISTS idx_dmc_date_type ON daily_metrics_contractor(service_date, service_type);
CREATE INDEX IF NOT EXISTS idx_incidents_contractor ON incidents(contractor_id);
