-- Track who/what performed the TO confirmation so the putaway log UI
-- can distinguish between user-driven manual confirms and automated
-- ones done by the OmniAgent triggers. NULL means unknown / legacy.
--
-- Values:
--   'manual'                 — user clicked Confirm in the putaway log UI
--   'agent_trigger'          — Omni-Agent confirmed via realtime trigger
--   'agent_one_click_ship'   — Omni-Agent confirmed as part of a shipment flow
--   (future sources can be added without schema change)

ALTER TABLE public.rf_putaway_operations
  ADD COLUMN IF NOT EXISTS confirmed_source text;

COMMENT ON COLUMN public.rf_putaway_operations.confirmed_source IS
  'Source of the TO confirmation: manual | agent_trigger | agent_one_click_ship';
