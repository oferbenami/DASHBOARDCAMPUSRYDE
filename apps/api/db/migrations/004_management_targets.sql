-- 004_management_targets.sql
-- Stage 5 targets hardening for Supabase provider parity

ALTER TABLE targets_history
  ALTER COLUMN target_value TYPE NUMERIC(12,4) USING target_value::NUMERIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'targets_history_direction_check'
  ) THEN
    ALTER TABLE targets_history
      ADD CONSTRAINT targets_history_direction_check
      CHECK (direction IN ('at_least', 'at_most'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_targets_history_effective_from ON targets_history(effective_from DESC);
