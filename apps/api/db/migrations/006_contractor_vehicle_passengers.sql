-- Add optional passenger split fields for contractor matrix details
ALTER TABLE IF EXISTS daily_metrics_contractor
  ADD COLUMN IF NOT EXISTS taxi_passengers INTEGER NOT NULL DEFAULT 0 CHECK (taxi_passengers >= 0),
  ADD COLUMN IF NOT EXISTS large_vehicle_passengers INTEGER NOT NULL DEFAULT 0 CHECK (large_vehicle_passengers >= 0);
