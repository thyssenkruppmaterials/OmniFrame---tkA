-- Migration: Add definition-level defaults to kit_definitions
-- Date: 2026-03-31
-- Description: Adds default_kit_cart_color and kit_container_type to kit_definitions
--   so BOM definitions can carry a default cart color and container type that
--   prefill into build plans and build sheets at creation time.

ALTER TABLE "public"."kit_definitions"
  ADD COLUMN IF NOT EXISTS "default_kit_cart_color" TEXT;

ALTER TABLE "public"."kit_definitions"
  ADD COLUMN IF NOT EXISTS "kit_container_type" VARCHAR(50);

COMMENT ON COLUMN "public"."kit_definitions"."default_kit_cart_color"
  IS 'Default hex color for build sheet sidebar; prefills kitCartColor on new build plans';

COMMENT ON COLUMN "public"."kit_definitions"."kit_container_type"
  IS 'Container type for this kit: kit_cart, pallet, or flight_case';
