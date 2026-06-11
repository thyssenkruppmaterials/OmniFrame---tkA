-- 332_enable_cycle_count_sticky_zone.sql
--
-- Enable Phase-2 aisle stickiness for the OmniFrame cycle-count org so the
-- pull-claim ranker keeps each operator progressing linearly down their CURRENT
-- aisle instead of yanking them to the globally-lowest aisle on every claim.
--
-- Pairs with the rust-work-service fix (Debug/Investigate-Cycle-Count-
-- Simultaneous-Claim-Aisle-Thrash-2026-05-29):
--   * The per-org claim advisory lock (`cyclecount_claim:<org>`) + the
--     assignment-state occupancy rewrite stop the simultaneous-claim aisle
--     SWAP (two workers trading aisles when they claim within ~1 s).
--   * This flag turns ON the stickiness that keeps a (now non-swapped) worker
--     continuing their own aisle. `claim_next_cycle_count` reads `sticky_zone`
--     to decide whether to compute a sticky aisle for ranking; with it FALSE
--     the sticky path is inert (preserves the configurable opt-out for orgs
--     that want pure global serpentine / cross-aisle balancing).
--
-- Scoped to the cycle-count org; idempotent (no-op if already enabled).
UPDATE public.cycle_count_zone_rules
SET sticky_zone = true
WHERE organization_id = 'c9d89a74-7179-4033-93ea-56267cf42a17'
  AND sticky_zone IS DISTINCT FROM true;
