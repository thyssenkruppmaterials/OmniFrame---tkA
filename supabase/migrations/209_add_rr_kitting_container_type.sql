-- Migration: Snapshot kit_container_type onto runtime build rows
-- Date: 2026-03-31
-- Description: Adds kit_container_type to RR_Kitting_DATA so the container type
--   chosen at build-plan creation time is preserved on runtime rows and the
--   printed build sheet does not drift when a definition is later edited.

ALTER TABLE "RR_Kitting_DATA"
  ADD COLUMN IF NOT EXISTS kit_container_type VARCHAR(50);

COMMENT ON COLUMN "RR_Kitting_DATA".kit_container_type
  IS 'Snapshot of kit_definitions.kit_container_type at build-plan creation time';
